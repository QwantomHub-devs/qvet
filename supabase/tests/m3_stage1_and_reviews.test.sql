begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

-- 1. Verify RLS is enabled on all 6 M3 tables
select ok(
  (select count(*) = 6 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('prompts', 'responses', 'rubrics', 'rubric_criteria', 'review_assignments', 'review_scores')
     and c.relrowsecurity = true),
  'All 6 M3 tables have Row Level Security enabled'
);

-- 2. Prepare Candidate 1 (UNILAG) up to approved
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select public.submit_onboarding(
  'Chinedu Okafor', 'Nigeria', '+234 803 111 2222', 'https://github.com/chinedu-okafor',
  2.5, 'Python, ML, RAG', 'Africa/Lagos', 25,
  '11111111-1111-1111-1111-111111111101'::uuid, null, 'ai', null, '{}'::jsonb, true
);

select public.record_id_upload(
  (select id from public.applications where user_id = auth.uid()),
  auth.uid()::text || '/' || (select id::text from public.applications where user_id = auth.uid()) || '/id.pdf',
  100000, 'application/pdf', 'NIN-11223344', 'Chinedu Okafor'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);
select public.admin_verify_id(
  (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
  'approved', 'Verified'
);

-- 3. Candidate 1 starts Stage 1 Part A (text), autosaves, and submits
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select lives_ok(
  $$
  select public.start_stage1_part((select id from public.applications where user_id = auth.uid()), 'text');
  select public.save_text_response(
    (select id from public.applications where user_id = auth.uid()),
    'Draft explanation of imbalanced data and recall vs precision for a manager.'
  );
  select public.submit_text_response(
    (select id from public.applications where user_id = auth.uid()),
    'A model with 95% accuracy on 5% fraud can simply predict not-fraud every time and miss 100% of actual fraud. We must check recall and precision on the fraud class instead.'
  );
  $$,
  'Candidate starts, autosaves, and submits Stage 1 Part A written explanation'
);

-- 4. Verify Reviewer 1 (same institution UNILAG as Candidate 1) was NOT assigned
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);

select is(
  (select count(*)::int from public.review_assignments where reviewer_id = '00000000-0000-0000-0000-000000000002'::uuid),
  0,
  'Same-institution reviewer (UNILAG) is never assigned to UNILAG candidate work'
);

select is(
  (select count(*)::int from public.review_assignments),
  2,
  'Two non-conflicting blind reviewers are assigned upon Part A submission'
);

-- 5. Verify direct attempt to assign same-institution reviewer is rejected by trigger
select throws_ok(
  $$
  select set_config('app.allow_review_write', 'true', true);
  insert into public.review_assignments (application_id, response_id, stage, part, reviewer_id, review_round)
  values (
    (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
    (select id from public.responses limit 1),
    1, 's1_text', '00000000-0000-0000-0000-000000000002'::uuid, 3
  );
  $$,
  '42501',
  null,
  'Trigger blocks assigning reviewer from the same institution as candidate'
);

-- 6. Verify blind reviewer queue never contains candidate name or institution
select pg_temp.act_as(
  (select reviewer_id from public.review_assignments where review_round = 1 limit 1)
);

select is(
  (select (public.get_reviewer_queue()::text ilike '%Chinedu%' or public.get_reviewer_queue()::text ilike '%UNILAG%')),
  false,
  'Blind review queue never exposes candidate name or institution'
);

-- 7. First assigned reviewer submits score = 4 across all 4 criteria (avg = 4.0)
select lives_ok(
  $$
  select public.submit_review(
    (select id from public.review_assignments where reviewer_id = auth.uid() limit 1),
    jsonb_build_array(
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000001', 'score', 4, 'comment', 'Clear'),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000002', 'score', 4, 'comment', 'Well structured'),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000003', 'score', 4, 'comment', 'Accurate'),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000004', 'score', 4, 'comment', 'Clean grammar')
    )
  );
  $$,
  'First reviewer submits rubric scores (avg 4.0)'
);

-- 8. Second assigned reviewer CANNOT see first reviewer''s scores BEFORE submitting their own
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);
select set_config(
  'app.second_reviewer',
  (select reviewer_id::text from public.review_assignments where status = 'assigned' limit 1),
  true
);

select pg_temp.act_as(current_setting('app.second_reviewer')::uuid);

select is(
  (select count(*)::int from public.review_scores),
  0,
  'Second reviewer cannot read first reviewer scores before submitting their own review'
);

select is(
  jsonb_array_length((public.get_reviewer_queue()->0->'peer_reviews')),
  0,
  'get_reviewer_queue hides peer_reviews until reviewer submits their own review'
);

-- 9. Second reviewer submits score = 2 across all 4 criteria (avg = 2.0, diff = 2.0 > 1.0) -> triggers 3rd reviewer!
select is(
  ((public.submit_review(
    (select id from public.review_assignments where reviewer_id = auth.uid() limit 1),
    jsonb_build_array(
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000001', 'score', 2),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000002', 'score', 2),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000003', 'score', 2),
      jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000004', 'score', 2)
    )
  ))->>'third_review_triggered')::boolean,
  true,
  'Difference of 2.0 (> 1.0) between first two reviewers automatically triggers a third review assignment'
);

-- 10. Now that second reviewer has submitted, they CAN see peer scores
select is(
  (select count(*)::int from public.review_scores),
  8,
  'After submitting own review, reviewer can read peer scores for that item'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select count(*)::int from public.review_assignments where is_third_review = true),
  1,
  'Third review assignment exists in review_assignments'
);

select * from finish();
rollback;

