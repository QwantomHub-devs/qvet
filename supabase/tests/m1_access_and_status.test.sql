begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

-- 1. Verify RLS is enabled on all M1 tables
select ok(
  (select count(*) = 7 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('settings', 'institutions', 'cohorts', 'profiles', 'applications', 'id_documents', 'audit_log')
     and c.relrowsecurity = true),
  'All 7 M1 tables have Row Level Security enabled'
);

-- Helper to simulate Supabase PostgREST authenticated session
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

-- 2. Act as Candidate 1 (Chinedu Okafor) and submit onboarding
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select lives_ok(
  $$
  select public.submit_onboarding(
    'Chinedu Okafor',
    'Nigeria',
    '+234 803 111 2222',
    'https://github.com/chinedu-okafor',
    2.5,
    'Python data cleaning, scikit-learn, and RAG evaluation',
    'Africa/Lagos',
    25,
    '11111111-1111-1111-1111-111111111101'::uuid,
    null,
    'ai',
    '22222222-2222-2222-2222-222222222201'::uuid,
    '{}'::jsonb,
    true
  );
  $$,
  'Candidate 1 can submit Stage 0 onboarding'
);

select is(
  (select status from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
  'registered',
  'New application starts in registered status'
);

-- 3. Candidate 1 cannot submit a second application
select throws_ok(
  $$
  select public.submit_onboarding(
    'Chinedu Okafor',
    'Nigeria',
    '+234 803 111 2222',
    'https://github.com/chinedu-okafor',
    2.5,
    'IoT firmware',
    'Africa/Lagos',
    25,
    '11111111-1111-1111-1111-111111111101'::uuid,
    null,
    'iot',
    null,
    '{}'::jsonb,
    true
  );
  $$,
  '23505',
  null,
  'Candidate cannot apply to a second track simultaneously'
);

-- 4. Act as Candidate 2 (Amina Yusuf): test duplicate phone & duplicate GitHub checks
select pg_temp.act_as('00000000-0000-0000-0000-000000000005'::uuid);

select throws_ok(
  $$
  select public.submit_onboarding(
    'Amina Yusuf',
    'Nigeria',
    '+234-803-111-2222',
    'https://github.com/amina-yusuf',
    3.0,
    'ESP32, MQTT, C++',
    'Africa/Lagos',
    30,
    '11111111-1111-1111-1111-111111111102'::uuid,
    null,
    'iot',
    null,
    '{"boards": ["ESP32"], "protocols": ["MQTT", "I2C"]}'::jsonb,
    true
  );
  $$,
  '23505',
  null,
  'Duplicate phone number across candidates is rejected'
);

select throws_ok(
  $$
  select public.submit_onboarding(
    'Amina Yusuf',
    'Nigeria',
    '+234 809 999 8888',
    'https://github.com/chinedu-okafor/',
    3.0,
    'ESP32, MQTT, C++',
    'Africa/Lagos',
    30,
    '11111111-1111-1111-1111-111111111102'::uuid,
    null,
    'iot',
    null,
    '{"boards": ["ESP32"], "protocols": ["MQTT", "I2C"]}'::jsonb,
    true
  );
  $$,
  '23505',
  null,
  'Duplicate GitHub URL across candidates is rejected'
);

-- Candidate 2 submits valid onboarding with "Other / Independent" institution option
select lives_ok(
  $$
  select public.submit_onboarding(
    'Amina Yusuf',
    'Nigeria',
    '+234 809 999 8888',
    'https://github.com/amina-yusuf',
    3.0,
    'ESP32, MQTT, C++',
    'Africa/Lagos',
    30,
    null,
    'Independent Embedded Lab Kano',
    'iot',
    null,
    '{"boards": ["ESP32", "STM32"], "protocols": ["MQTT", "I2C", "SPI"], "has_hardware_access": true}'::jsonb,
    true
  );
  $$,
  'Candidate 2 can submit onboarding with Other / Independent institution'
);

-- 5. Cross-candidate RLS checks (Candidate 2 cannot read Candidate 1 data)
select is(
  (select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
  0,
  'Candidate 2 cannot read Candidate 1 profile'
);

select is(
  (select count(*)::int from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
  0,
  'Candidate 2 cannot read Candidate 1 application'
);

select is(
  (select count(*)::int from public.audit_log),
  0,
  'Candidate cannot read audit_log'
);

-- 6. Reviewer RLS checks (Reviewer cannot read candidate profiles or applications)
select pg_temp.act_as('00000000-0000-0000-0000-000000000002'::uuid);

select is(
  (select count(*)::int from public.profiles where role = 'candidate'),
  0,
  'Reviewer cannot read any candidate profiles (blind review rule)'
);

select is(
  (select count(*)::int from public.applications),
  0,
  'Reviewer cannot read applications table directly'
);

-- 7. Candidate cannot write role, status, or score
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select throws_ok(
  $$
  update public.profiles set role = 'admin' where user_id = auth.uid();
  $$,
  '42501',
  null,
  'Candidate cannot escalate their own role to admin'
);

select is(
  (
    with updated as (
      update public.applications set status = 'approved' where user_id = auth.uid() returning id
    )
    select count(*)::int from updated
  ),
  0,
  'Candidate cannot directly UPDATE application status (blocked by RLS)'
);

select is(
  (
    with updated as (
      update public.applications set score = 99.5 where user_id = auth.uid() returning id
    )
    select count(*)::int from updated
  ),
  0,
  'Candidate cannot directly UPDATE application score (blocked by RLS)'
);

select throws_ok(
  $$
  select public.advance_status(
    (select id from public.applications where user_id = auth.uid()),
    'id_pending',
    'Trying to bypass ID upload'
  );
  $$,
  '42501',
  null,
  'Candidate cannot call advance_status directly'
);

-- 8. ID upload checks (name match, duplicate ID number, transition to id_pending)
select throws_ok(
  $$
  select public.record_id_upload(
    (select id from public.applications where user_id = auth.uid()),
    auth.uid()::text || '/' || (select id::text from public.applications where user_id = auth.uid()) || '/nin.pdf',
    204800,
    'application/pdf',
    'NIN-12345678901',
    'Wrong Person Name'
  );
  $$,
  '22023',
  null,
  'record_id_upload rejects ID when name_on_id does not match profile full_name'
);

select lives_ok(
  $$
  select public.record_id_upload(
    (select id from public.applications where user_id = auth.uid()),
    auth.uid()::text || '/' || (select id::text from public.applications where user_id = auth.uid()) || '/nin.pdf',
    204800,
    'application/pdf',
    'NIN-12345678901',
    'Chinedu Okafor'
  );
  $$,
  'Candidate 1 uploads ID and transitions to id_pending'
);

select is(
  (select status from public.applications where user_id = auth.uid()),
  'id_pending',
  'Application status is id_pending after ID upload'
);

-- Candidate 2 tries to upload the exact same Government ID number
select pg_temp.act_as('00000000-0000-0000-0000-000000000005'::uuid);

select throws_ok(
  $$
  select public.record_id_upload(
    (select id from public.applications where user_id = auth.uid()),
    auth.uid()::text || '/' || (select id::text from public.applications where user_id = auth.uid()) || '/nin.png',
    150000,
    'image/png',
    'nin 12345678901',
    'Amina Yusuf'
  );
  $$,
  '23505',
  null,
  'Duplicate government ID number across candidates is rejected'
);

-- 9. Illegal status transitions rejected even for Admin
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);

select throws_ok(
  $$
  select public.advance_status(
    (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
    's1_open',
    'Trying to skip approval'
  );
  $$,
  '23514',
  null,
  'Illegal transition id_pending -> s1_open is rejected'
);

select throws_ok(
  $$
  select public.advance_status(
    (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000005'::uuid),
    'approved',
    'Trying to approve before ID upload'
  );
  $$,
  '23514',
  null,
  'Illegal transition registered -> approved is rejected'
);

-- 10. Admin ID view is logged; rejection -> re-upload -> approval flow works
select lives_ok(
  $$
  select public.log_admin_id_view(
    (select d.id from public.id_documents d
     join public.applications a on a.id = d.application_id
     where a.user_id = '00000000-0000-0000-0000-000000000004'::uuid and d.is_current = true)
  );
  $$,
  'Admin viewing an ID document succeeds and logs to audit_log'
);

select is(
  (select count(*)::int from public.audit_log where action = 'id_document_viewed' and actor = '00000000-0000-0000-0000-000000000001'::uuid),
  1,
  'Admin read of ID document is recorded in audit_log'
);

-- Admin rejects ID first, Candidate 1 re-uploads, Admin approves
select lives_ok(
  $$
  select public.admin_verify_id(
    (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
    'rejected',
    'ID corners were cropped out'
  );
  $$,
  'Admin can reject an unclear ID with a reason'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000004'::uuid);

select lives_ok(
  $$
  select public.record_id_upload(
    (select id from public.applications where user_id = auth.uid()),
    auth.uid()::text || '/' || (select id::text from public.applications where user_id = auth.uid()) || '/nin-clear.pdf',
    250000,
    'application/pdf',
    'NIN-12345678901',
    'Chinedu Okafor'
  );
  $$,
  'Rejected candidate can upload a new ID to return to id_pending'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000001'::uuid);

select lives_ok(
  $$
  select public.admin_verify_id(
    (select id from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
    'approved',
    'Clear ID verified'
  );
  $$,
  'Admin approves candidate ID and status advances to approved (stage 1 unlocked)'
);

select is(
  (select status || ':' || current_stage::text from public.applications where user_id = '00000000-0000-0000-0000-000000000004'::uuid),
  'approved:1',
  'Application status becomes approved and current_stage auto-advances to 1'
);

select * from finish();
rollback;

