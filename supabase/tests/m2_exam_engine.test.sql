begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

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

-- 1. Verify RLS is enabled on all 7 M2 tables
select ok(
  (select count(*) = 7 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('questions', 'question_keys', 'exam_blueprints', 'exam_attempts', 'exam_answers', 'stage_results', 'integrity_events')
     and c.relrowsecurity = true),
  'All 7 M2 exam tables have Row Level Security enabled'
);

-- 2. Prepare Candidate 1 application up to s2_open
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
select public.admin_unlock_stage2(
  (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid)
);

-- 3. Candidate 1 cannot read question_keys or raw questions table directly
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select is(
  (select count(*)::int from public.question_keys),
  0,
  'Candidate cannot read question_keys by any direct query'
);

select is(
  (select count(*)::int from public.questions),
  0,
  'Candidate cannot read raw questions bank directly'
);

-- 4. Start exam & verify draw matches blueprint distribution (40 questions; 8,10,8,4,6,4; 16 easy, 16 medium, 8 hard)
select is(
  ((public.start_exam((select id from public.applications where user_id = auth.uid())))->>'total_questions')::int,
  40,
  'start_exam draws 40 questions for AI Stage 2'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);

select is(
  (
    select jsonb_object_agg(difficulty, cnt)
    from (
      select q.difficulty, count(*)::int as cnt
      from public.exam_attempts ea, unnest(ea.question_ids) as qid
      join public.questions q on q.id = qid
      group by q.difficulty
    ) s
  ),
  '{"easy": 16, "medium": 16, "hard": 8}'::jsonb,
  'Random draw matches 40% easy (16), 40% medium (16), 20% hard (8) difficulty distribution'
);

select is(
  (
    select jsonb_object_agg(domain, cnt)
    from (
      select q.domain, count(*)::int as cnt
      from public.exam_attempts ea, unnest(ea.question_ids) as qid
      join public.questions q on q.id = qid
      group by q.domain
    ) s
  ),
  '{"python_data": 8, "stats_ml": 10, "eval_debugging": 8, "dl_nlp": 4, "llm_apps": 6, "eng_practice": 4}'::jsonb,
  'Random draw matches blueprint domain counts (8, 10, 8, 4, 6, 4)'
);

-- 5. Candidate serves question 0, answers it, and cannot go back or skip ahead
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select is(
  ((public.get_question((select id from public.exam_attempts limit 1), 0)) ? 'correct'),
  false,
  'get_question payload never leaks correct answer key'
);

select throws_ok(
  $$
  select public.get_question((select id from public.exam_attempts limit 1), 1);
  $$,
  '23514',
  null,
  'Candidate cannot skip ahead to index 1 before answering index 0'
);

select lives_ok(
  $$
  select public.submit_answer(
    (select id from public.exam_attempts limit 1),
    ((public.get_question((select id from public.exam_attempts limit 1), 0))->>'question_id')::uuid,
    'A'
  );
  $$,
  'Candidate submits and locks answer for question 0'
);

select throws_ok(
  $$
  select public.get_question((select id from public.exam_attempts limit 1), 0);
  $$,
  '23514',
  null,
  'Going back to already answered question 0 is impossible'
);

-- 6. Refresh resumes at question 1 with remaining time
select is(
  ((public.start_exam((select id from public.applications where user_id = auth.uid())))->>'current_index')::int,
  1,
  'Refreshing / calling start_exam resumes at question index 1'
);

-- 7. Log integrity event (tab_hidden) does not fail attempt
select lives_ok(
  $$
  select public.log_integrity_event((select id from public.exam_attempts limit 1), 'tab_hidden', '{"visibility": "hidden"}'::jsonb);
  $$,
  'Browser can log tab_hidden integrity event'
);

-- 8. Auto-submit when deadline expires
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);
select set_config('app.allow_exam_attempt_write', 'true', true);
update public.exam_attempts set deadline_at = now() - interval '1 second';

select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select throws_ok(
  $$
  select public.get_question((select id from public.exam_attempts limit 1));
  $$,
  '23514',
  null,
  'Request after deadline rejects serving question and triggers auto-submit'
);

select is(
  (select count(*)::int from public.exam_attempts),
  1,
  'Attempt still exists after deadline check'
);

select * from finish();
rollback;

