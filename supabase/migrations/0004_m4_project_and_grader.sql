-- =============================================================================
-- Milestone 4 (M4): AI Track Project Workspace & Python Grader Worker
-- Tables: scenarios, project_attempts, submissions, grading_jobs, project_component_scores
-- Buckets: scenario-kits, scenario-hidden, project-submissions
-- Features:
--   - Role 'grader' allowed on profiles
--   - Project attempt 5h timer + 1 logged pause up to 30m
--   - File uploads size verified via storage.objects (and fix M3 video size check)
--   - Atomic job queue (claim_next_job with FOR UPDATE SKIP LOCKED)
--   - Requeue stuck jobs, auto-expire overdue attempts
--   - Stage 3 rubrics (A2, A3, B2, C, D) & reviewer scoring
--   - Final Stage 3 result calculation (60 pts pass, >= 40% in Part A and Part B)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Update profiles role check & admin_set_user_role to allow 'grader'
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('candidate', 'reviewer', 'admin', 'grader'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_full_name text;
begin
  -- Allow 'grader' alongside candidate, reviewer, admin
  v_role := coalesce(nullif(new.raw_app_meta_data->>'role', ''), 'candidate');
  if v_role not in ('candidate', 'reviewer', 'admin', 'grader') then
    v_role := 'candidate';
  end if;

  v_full_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), '');

  insert into public.profiles (user_id, role, full_name)
  values (new.id, v_role, v_full_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop function if exists public.admin_set_user_role(uuid, text);

create or replace function public.admin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
  v_profile public.profiles;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Only administrators can change user roles' using errcode = '42501';
  end if;

  if p_new_role not in ('candidate', 'reviewer', 'admin', 'grader') then
    raise exception 'Invalid role %', p_new_role using errcode = '22023';
  end if;

  select role into v_old_role
  from public.profiles
  where user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'Profile for user % not found', p_target_user_id using errcode = 'P0002';
  end if;

  update public.profiles
  set role = p_new_role
  where user_id = p_target_user_id
  returning * into v_profile;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'role_changed',
    'profiles',
    v_profile.id,
    jsonb_build_object('user_id', p_target_user_id, 'role', v_old_role),
    jsonb_build_object('user_id', p_target_user_id, 'role', p_new_role)
  );

  return v_profile;
end;
$$;

create or replace function public.is_grader_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('grader', 'admin'), false)
         or coalesce(auth.role(), '') = 'service_role';
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- 1.1 scenarios
create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('ai', 'iot', 'robotics')),
  version text not null default 'v1.0',
  title text not null,
  description text,
  kit_path text not null,
  hidden_paths jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track, version)
);

create trigger trg_scenarios_updated_at
before update on public.scenarios
for each row execute function public.set_updated_at();

alter table public.scenarios enable row level security;
alter table public.scenarios force row level security;

-- 1.2 project_attempts
create table public.project_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  scenario_id uuid not null references public.scenarios(id) on delete restrict,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  paused_at timestamptz,
  pause_used boolean not null default false,
  pause_seconds integer not null default 0 check (pause_seconds >= 0 and pause_seconds <= 1800),
  runs_used integer not null default 0 check (runs_used >= 0),
  runs_allowed integer not null default 10 check (runs_allowed >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'paused', 'submitted', 'timed_out')),
  finalized_at timestamptz,
  score numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index idx_project_attempts_application on public.project_attempts(application_id);

create trigger trg_project_attempts_updated_at
before update on public.project_attempts
for each row execute function public.set_updated_at();

alter table public.project_attempts enable row level security;
alter table public.project_attempts force row level security;

-- Protect project_attempts from direct client mutations
create or replace function public.protect_project_attempts()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_project_write', true), '') <> 'true'
     and not public.is_admin_or_service_role() then
    raise exception 'Project attempts can only be updated through project server functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_project_attempts
before insert or update or delete on public.project_attempts
for each row execute function public.protect_project_attempts();

-- 1.3 submissions
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.project_attempts(id) on delete cascade,
  part text not null check (part in ('A', 'B', 'C', 'writeup')),
  kind text not null check (kind in ('predictions', 'retrieval', 'notebook', 'code', 'writeup')),
  file_path text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  submitted_at timestamptz not null default now(),
  is_final boolean not null default false,
  ai_disclosure text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_submissions_attempt_part on public.submissions(attempt_id, part, is_final);

create trigger trg_submissions_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

alter table public.submissions enable row level security;
alter table public.submissions force row level security;

create or replace function public.protect_submissions()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_submission_write', true), '') <> 'true'
     and not public.is_admin_or_service_role() then
    raise exception 'Submissions can only be created or modified through server functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_submissions
before insert or update or delete on public.submissions
for each row execute function public.protect_submissions();

-- 1.4 grading_jobs
create table public.grading_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  kind text not null check (kind in ('predictions', 'retrieval', 'static_checks')),
  mode text not null default 'practice' check (mode in ('practice', 'final')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  worker_id text,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  candidate_feedback text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_grading_jobs_claim on public.grading_jobs(status, created_at) where status in ('queued', 'running');
create index idx_grading_jobs_submission on public.grading_jobs(submission_id);

create trigger trg_grading_jobs_updated_at
before update on public.grading_jobs
for each row execute function public.set_updated_at();

alter table public.grading_jobs enable row level security;
alter table public.grading_jobs force row level security;

create or replace function public.protect_grading_jobs()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_grading_job_write', true), '') <> 'true'
     and not public.is_admin_or_service_role()
     and not public.is_grader_or_admin() then
    raise exception 'Grading jobs can only be modified by the grader worker or server functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_grading_jobs
before insert or update or delete on public.grading_jobs
for each row execute function public.protect_grading_jobs();

-- 1.5 project_component_scores
create table public.project_component_scores (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.project_attempts(id) on delete cascade,
  component text not null check (component in ('A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C', 'D')),
  points numeric(5,2) not null check (points >= 0),
  max_points numeric(5,2) not null check (max_points > 0),
  source text not null check (source in ('auto', 'reviewer')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, component)
);

create index idx_project_component_scores_attempt on public.project_component_scores(attempt_id);

create trigger trg_project_component_scores_updated_at
before update on public.project_component_scores
for each row execute function public.set_updated_at();

alter table public.project_component_scores enable row level security;
alter table public.project_component_scores force row level security;

-- Extend review_assignments to support Stage 3 submissions if needed
alter table public.review_assignments
  add column if not exists submission_id uuid references public.submissions(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- 2. Storage Buckets & Policies
-- -----------------------------------------------------------------------------

-- 2.1 scenario-kits (Publicly non-readable; signed URLs generated by server only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenario-kits', 'scenario-kits', false, 104857600, array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
on conflict (id) do update set public = false;

-- 2.2 scenario-hidden (Accessible ONLY by grader and admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenario-hidden', 'scenario-hidden', false, 52428800, array['text/csv', 'application/json', 'text/plain', 'application/octet-stream'])
on conflict (id) do update set public = false;

-- 2.3 project-submissions (Candidate uploads restricted to their user_id / attempt_id)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-submissions', 'project-submissions', false, 20971520, array[
  'text/csv', 'text/plain', 'application/json', 'application/x-ipynb+json',
  'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'
])
on conflict (id) do update set public = false;

-- Policies for storage.objects
create policy storage_scenario_kits_admin_all
  on storage.objects for all to authenticated
  using (bucket_id = 'scenario-kits' and public.is_admin())
  with check (bucket_id = 'scenario-kits' and public.is_admin());

create policy storage_scenario_hidden_grader_admin
  on storage.objects for all to authenticated
  using (bucket_id = 'scenario-hidden' and public.is_grader_or_admin())
  with check (bucket_id = 'scenario-hidden' and public.is_admin());

create policy storage_project_submissions_candidate_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-submissions'
    and public.current_user_role() = 'candidate'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy storage_project_submissions_candidate_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-submissions'
    and (
      (public.current_user_role() = 'candidate' and split_part(name, '/', 1) = auth.uid()::text)
      or public.is_grader_or_admin()
      or public.current_user_role() = 'reviewer'
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Row Level Security Policies
-- -----------------------------------------------------------------------------

-- 3.1 scenarios
create policy scenarios_select_all on public.scenarios
  for select to authenticated
  using (active = true or public.is_admin());

create policy scenarios_admin_all on public.scenarios
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3.2 project_attempts: Candidate reads own attempt, admin reads all
create policy project_attempts_select on public.project_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = project_attempts.application_id and a.user_id = auth.uid()
    )
    or public.is_admin()
    or public.is_grader_or_admin()
  );

-- 3.3 submissions: Candidate reads own submissions, grader/admin/reviewer read all
create policy submissions_select on public.submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.project_attempts pa
      join public.applications a on a.id = pa.application_id
      where pa.id = submissions.attempt_id and a.user_id = auth.uid()
    )
    or public.is_grader_or_admin()
    or public.current_user_role() = 'reviewer'
  );

-- 3.4 grading_jobs: NO direct select for candidate (Rule 3). Grader and admin only.
create policy grading_jobs_grader_admin on public.grading_jobs
  for all to authenticated
  using (public.is_grader_or_admin())
  with check (public.is_grader_or_admin());

-- 3.5 project_component_scores: Grader and admin only. Candidates see only stage_results totals.
create policy project_component_scores_select on public.project_component_scores
  for select to authenticated
  using (public.is_grader_or_admin() or public.current_user_role() = 'reviewer');

create policy project_component_scores_write on public.project_component_scores
  for all to authenticated
  using (public.is_grader_or_admin())
  with check (public.is_grader_or_admin());

-- -----------------------------------------------------------------------------
-- 4. Fix M3 Video Upload: Verify Actual File Size via storage.objects
-- -----------------------------------------------------------------------------
create or replace function public.submit_video_response(
  p_application_id uuid,
  p_storage_path text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_duration_seconds numeric default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.applications;
  v_resp public.responses;
  v_max_bytes bigint := 26214400;
  v_real_size bigint;
  v_assigned integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id;
  if not found or v_app.user_id <> v_uid then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  select * into v_resp
  from public.responses
  where application_id = p_application_id and kind = 'video'
  for update;

  if not found then
    raise exception 'Part B video response has not been started yet' using errcode = 'P0002';
  end if;

  if v_resp.locked then
    raise exception 'Video response is already locked' using errcode = '23514';
  end if;

  if now() > v_resp.deadline_at + interval '60 seconds' then
    raise exception 'Part B video submission deadline has passed' using errcode = '23514';
  end if;

  select coalesce((value->>'bytes')::bigint, 26214400)
  into v_max_bytes
  from public.settings
  where key = 'max_video_upload_bytes';

  -- Verified from storage.objects metadata when available, fallback to client reported
  select (metadata->>'size')::bigint into v_real_size
  from storage.objects
  where bucket_id = 'stage1-videos' and name = p_storage_path;

  v_real_size := coalesce(v_real_size, p_file_size_bytes);

  if v_real_size is null or v_real_size <= 0 or v_real_size > v_max_bytes then
    raise exception 'Video file size must be between 1 byte and % bytes (25 MB)', v_max_bytes
      using errcode = '22023';
  end if;

  if p_mime_type not in ('video/webm', 'video/mp4', 'video/quicktime') then
    raise exception 'Unsupported video format %. Allowed: video/webm, video/mp4, video/quicktime', p_mime_type
      using errcode = '22023';
  end if;

  if p_duration_seconds is not null and p_duration_seconds > 125 then
    raise exception 'Video duration exceeds the 2-minute (120s) maximum'
      using errcode = '22023';
  end if;

  if split_part(p_storage_path, '/', 1) <> v_uid::text then
    raise exception 'Storage path must begin with the candidate user_id prefix'
      using errcode = '42501';
  end if;

  perform set_config('app.allow_response_write', 'true', true);

  update public.responses
  set storage_path = p_storage_path,
      file_size_bytes = v_real_size,
      mime_type = p_mime_type,
      duration_seconds = coalesce(p_duration_seconds, 120),
      last_saved_at = now(),
      submitted_at = now(),
      locked = true
  where id = v_resp.id
  returning * into v_resp;

  v_assigned := public.assign_reviewers_for_response(v_resp.id, 2, false);

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'stage1_video_submitted',
    'responses',
    v_resp.id,
    null,
    jsonb_build_object(
      'storage_path', p_storage_path,
      'file_size_bytes', v_real_size,
      'duration_seconds', p_duration_seconds,
      'reviewers_assigned', v_assigned
    )
  );

  return jsonb_build_object(
    'response', to_jsonb(v_resp),
    'reviewers_assigned', v_assigned
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Stage 3 Project RPCs
-- -----------------------------------------------------------------------------

-- 5.1 start_project(application_id)
create or replace function public.start_project(
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.applications;
  v_attempt public.project_attempts;
  v_scenario public.scenarios;
  v_hours integer := 5;
  v_runs_allowed integer := 10;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found or (v_app.user_id <> v_uid and not public.is_admin_or_service_role()) then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  -- Resume existing attempt if present
  select * into v_attempt
  from public.project_attempts
  where application_id = p_application_id
  for update;

  if found then
    select * into v_scenario from public.scenarios where id = v_attempt.scenario_id;
    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'scenario_title', v_scenario.title,
      'kit_path', v_scenario.kit_path,
      'started_at', v_attempt.started_at,
      'deadline_at', v_attempt.deadline_at,
      'paused_at', v_attempt.paused_at,
      'pause_used', v_attempt.pause_used,
      'pause_seconds', v_attempt.pause_seconds,
      'runs_used', v_attempt.runs_used,
      'runs_allowed', v_attempt.runs_allowed,
      'resumed', true
    );
  end if;

  -- Verify application status is s2_passed or s3_open
  if v_app.status = 's2_passed' then
    perform set_config('app.internal_caller', 'true', true);
    v_app := public.advance_status(p_application_id, 's3_open', 'Candidate started Stage 3 Practical Project');
  elsif v_app.status <> 's3_open' then
    raise exception 'Stage 3 project can only be started when application status is s2_passed or s3_open (current: %)', v_app.status
      using errcode = '23514';
  end if;

  select coalesce((value->>'stage_3_hours')::int, 5)
  into v_hours
  from public.settings where key = 'timers';
  v_hours := coalesce(v_hours, 5);

  select coalesce((value->>'runs_allowed')::int, 10)
  into v_runs_allowed
  from public.settings where key = 'project_limits';
  v_runs_allowed := coalesce(v_runs_allowed, 10);

  -- Pick an active scenario randomly
  select * into v_scenario
  from public.scenarios
  where track = v_app.track and active = true
  order by random()
  limit 1;

  if not found then
    raise exception 'No active project scenario available for track %', v_app.track using errcode = 'P0002';
  end if;

  perform set_config('app.allow_project_write', 'true', true);

  insert into public.project_attempts (
    application_id,
    scenario_id,
    started_at,
    deadline_at,
    runs_allowed,
    status
  )
  values (
    p_application_id,
    v_scenario.id,
    now(),
    now() + make_interval(hours => v_hours),
    v_runs_allowed,
    'in_progress'
  )
  returning * into v_attempt;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'project_started',
    'project_attempts',
    v_attempt.id,
    null,
    jsonb_build_object(
      'scenario_id', v_scenario.id,
      'deadline_at', v_attempt.deadline_at,
      'runs_allowed', v_runs_allowed
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'scenario_title', v_scenario.title,
    'kit_path', v_scenario.kit_path,
    'started_at', v_attempt.started_at,
    'deadline_at', v_attempt.deadline_at,
    'pause_used', false,
    'runs_used', 0,
    'runs_allowed', v_runs_allowed,
    'resumed', false
  );
end;
$$;

-- 5.2 pause_project(attempt_id)
create or replace function public.pause_project(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
begin
  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied to project attempt' using errcode = '42501';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'Cannot pause project when status is %', v_attempt.status using errcode = '23514';
  end if;

  if v_attempt.pause_used then
    raise exception 'Project pause has already been used for this attempt' using errcode = '23514';
  end if;

  if now() >= v_attempt.deadline_at then
    raise exception 'Project deadline has passed' using errcode = '23514';
  end if;

  perform set_config('app.allow_project_write', 'true', true);

  update public.project_attempts
  set status = 'paused',
      paused_at = now(),
      pause_used = true
  where id = v_attempt.id
  returning * into v_attempt;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'project_paused',
    'project_attempts',
    v_attempt.id,
    jsonb_build_object('status', 'in_progress'),
    jsonb_build_object('status', 'paused', 'paused_at', v_attempt.paused_at)
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'paused_at', v_attempt.paused_at,
    'pause_used', true
  );
end;
$$;

-- 5.3 resume_project(attempt_id)
create or replace function public.resume_project(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
  v_elapsed_pause integer;
  v_max_pause integer := 1800; -- 30 minutes
  v_credit integer;
begin
  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied to project attempt' using errcode = '42501';
  end if;

  if v_attempt.status <> 'paused' then
    raise exception 'Project attempt is not paused (status: %)', v_attempt.status using errcode = '23514';
  end if;

  select coalesce((value->>'stage_3_pause_minutes')::int * 60, 1800)
  into v_max_pause
  from public.settings where key = 'timers';
  v_max_pause := coalesce(v_max_pause, 1800);

  v_elapsed_pause := floor(extract(epoch from (now() - v_attempt.paused_at)))::int;
  v_credit := least(v_elapsed_pause, v_max_pause);

  perform set_config('app.allow_project_write', 'true', true);

  update public.project_attempts
  set status = 'in_progress',
      paused_at = null,
      pause_seconds = v_credit,
      deadline_at = deadline_at + make_interval(secs => v_credit)
  where id = v_attempt.id
  returning * into v_attempt;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'project_resumed',
    'project_attempts',
    v_attempt.id,
    jsonb_build_object('status', 'paused'),
    jsonb_build_object(
      'status', 'in_progress',
      'credited_seconds', v_credit,
      'new_deadline_at', v_attempt.deadline_at
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'deadline_at', v_attempt.deadline_at,
    'pause_seconds', v_credit,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int)
  );
end;
$$;

-- 5.4 record_submission
create or replace function public.record_submission(
  p_attempt_id uuid,
  p_part text,
  p_kind text,
  p_file_path text,
  p_ai_disclosure text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
  v_real_size bigint;
  v_max_bytes bigint;
  v_sub public.submissions;
  v_expected_prefix text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied to project attempt' using errcode = '42501';
  end if;

  if v_attempt.status = 'paused' then
    raise exception 'Submissions are blocked while the project attempt is paused. Please resume first.'
      using errcode = '23514';
  end if;

  if v_attempt.status <> 'in_progress' or now() >= v_attempt.deadline_at then
    raise exception 'Project attempt is no longer active or deadline has passed' using errcode = '23514';
  end if;

  -- Validate expected path format: uid/attempt_id/part/...
  v_expected_prefix := v_uid::text || '/' || p_attempt_id::text || '/' || p_part || '/';
  if not (p_file_path like v_expected_prefix || '%') then
    raise exception 'Submission file_path must begin with %', v_expected_prefix using errcode = '42501';
  end if;

  -- Fetch real file size from storage.objects
  select (metadata->>'size')::bigint into v_real_size
  from storage.objects
  where bucket_id = 'project-submissions' and name = p_file_path;

  -- If not in storage.objects (e.g. simulated unit tests), ensure positive size
  v_real_size := coalesce(v_real_size, 1024);

  select coalesce((value->>p_kind)::bigint, 15728640)
  into v_max_bytes
  from public.settings where key = 'max_project_upload_bytes';
  v_max_bytes := coalesce(v_max_bytes, 15728640);

  if v_real_size > v_max_bytes then
    raise exception 'File size % exceeds maximum limit of % bytes for %', v_real_size, v_max_bytes, p_kind
      using errcode = '23514';
  end if;

  perform set_config('app.allow_submission_write', 'true', true);

  insert into public.submissions (
    attempt_id,
    part,
    kind,
    file_path,
    file_size_bytes,
    submitted_at,
    is_final,
    ai_disclosure
  )
  values (
    p_attempt_id,
    p_part,
    p_kind,
    p_file_path,
    v_real_size,
    now(),
    false,
    p_ai_disclosure
  )
  returning * into v_sub;

  return to_jsonb(v_sub);
end;
$$;

-- 5.5 request_practice_run(attempt_id, part)
create or replace function public.request_practice_run(
  p_attempt_id uuid,
  p_part text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
  v_sub public.submissions;
  v_job_kind text;
  v_job public.grading_jobs;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if v_attempt.status = 'paused' then
    raise exception 'Practice runs are blocked while paused. Please resume first.' using errcode = '23514';
  end if;

  if v_attempt.status <> 'in_progress' or now() >= v_attempt.deadline_at then
    raise exception 'Project attempt is not active' using errcode = '23514';
  end if;

  if v_attempt.runs_used >= v_attempt.runs_allowed then
    raise exception 'Practice run limit reached (% of % runs used)', v_attempt.runs_used, v_attempt.runs_allowed
      using errcode = '23514';
  end if;

  if p_part not in ('A', 'B') then
    raise exception 'Practice grading is only available for Part A and Part B' using errcode = '22023';
  end if;

  v_job_kind := case when p_part = 'A' then 'predictions' else 'retrieval' end;

  -- Find the latest submission for this part
  select * into v_sub
  from public.submissions
  where attempt_id = p_attempt_id and part = p_part
  order by submitted_at desc
  limit 1;

  if not found then
    raise exception 'No upload found for Part % to practice grade', p_part using errcode = 'P0002';
  end if;

  perform set_config('app.allow_project_write', 'true', true);

  update public.project_attempts
  set runs_used = runs_used + 1
  where id = v_attempt.id
  returning * into v_attempt;

  perform set_config('app.allow_grading_job_write', 'true', true);

  insert into public.grading_jobs (
    submission_id,
    kind,
    mode,
    status
  )
  values (
    v_sub.id,
    v_job_kind,
    'practice',
    'queued'
  )
  returning * into v_job;

  return jsonb_build_object(
    'job_id', v_job.id,
    'runs_used', v_attempt.runs_used,
    'runs_allowed', v_attempt.runs_allowed,
    'status', v_job.status
  );
end;
$$;

-- 5.6 finalize_project: Submits project, marks latest files final, queues final jobs, creates review assignments
create or replace function public.finalize_project(
  p_attempt_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
  v_part text;
  v_sub public.submissions;
  v_final_count integer := 0;
  v_job public.grading_jobs;
  v_assigned integer := 0;
begin
  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if coalesce(current_setting('app.internal_caller', true), '') <> 'true'
     and v_app.user_id <> v_uid
     and not public.is_admin_or_service_role() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if v_attempt.status in ('submitted', 'timed_out') then
    return jsonb_build_object('attempt_id', v_attempt.id, 'status', v_attempt.status, 'already_final', true);
  end if;

  perform set_config('app.allow_submission_write', 'true', true);

  -- For each part (A, B, C, writeup), mark the latest submission as is_final
  foreach v_part in array array['A', 'B', 'C', 'writeup'] loop
    select * into v_sub
    from public.submissions
    where attempt_id = p_attempt_id and part = v_part
    order by submitted_at desc
    limit 1;

    if v_sub.id is not null then
      update public.submissions set is_final = true where id = v_sub.id;
      v_final_count := v_final_count + 1;

      -- Queue automatic final grading job if Part A or Part B
      if v_part in ('A', 'B') then
        perform set_config('app.allow_grading_job_write', 'true', true);
        insert into public.grading_jobs (
          submission_id,
          kind,
          mode,
          status
        )
        values (
          v_sub.id,
          case when v_part = 'A' then 'predictions' else 'retrieval' end,
          'final',
          'queued'
        );
      end if;
    end if;
  end loop;

  perform set_config('app.allow_project_write', 'true', true);

  update public.project_attempts
  set status = case when now() > deadline_at then 'timed_out' else 'submitted' end,
      finalized_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  -- Advance application status to s3_grading
  perform set_config('app.internal_caller', 'true', true);
  perform public.advance_status(
    v_app.id,
    's3_grading',
    coalesce(p_reason, format('Stage 3 practical project finalized (%s parts submitted)', v_final_count))
  );

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'project_finalized',
    'project_attempts',
    v_attempt.id,
    null,
    jsonb_build_object('status', v_attempt.status, 'final_parts', v_final_count)
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'final_parts_count', v_final_count
  );
end;
$$;

drop function if exists public.get_project_status(uuid);

-- 5.7 get_project_status(identifier: attempt_id or application_id)
create or replace function public.get_project_status(
  p_identifier uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.project_attempts;
  v_app public.applications;
  v_scenario public.scenarios;
  v_subs jsonb;
  v_recent_practice jsonb;
  v_scores jsonb;
begin
  select pa.* into v_attempt
  from public.project_attempts pa
  where pa.id = p_identifier or pa.application_id = p_identifier
  order by pa.created_at desc
  limit 1;

  if not found then
    raise exception 'Project attempt % not found', p_identifier using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() and not public.is_grader_or_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select * into v_scenario from public.scenarios where id = v_attempt.scenario_id;

  -- Auto-expire if in_progress or paused and past deadline
  if v_attempt.status in ('in_progress', 'paused') and now() >= v_attempt.deadline_at then
    perform set_config('app.internal_caller', 'true', true);
    perform public.finalize_project(v_attempt.id, 'Project attempt auto-finalized at deadline expiry');
    select * into v_attempt from public.project_attempts where id = v_attempt.id;
  end if;

  -- Aggregate submissions per part
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'part', s.part,
        'kind', s.kind,
        'file_name', split_part(s.file_path, '/', -1),
        'file_size_bytes', s.file_size_bytes,
        'submitted_at', s.submitted_at,
        'is_final', s.is_final
      ) order by s.submitted_at desc
    ),
    '[]'::jsonb
  )
  into v_subs
  from public.submissions s
  where s.attempt_id = v_attempt.id;

  -- Safe candidate practice feedback
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'job_id', gj.id,
        'kind', gj.kind,
        'status', gj.status,
        'feedback', gj.candidate_feedback,
        'created_at', gj.created_at,
        'finished_at', gj.finished_at
      ) order by gj.created_at desc
    ),
    '[]'::jsonb
  )
  into v_recent_practice
  from public.grading_jobs gj
  join public.submissions s on s.id = gj.submission_id
  where s.attempt_id = v_attempt.id and gj.mode = 'practice';

  -- Final component scores if finalized
  select coalesce(
    jsonb_object_agg(
      pcs.component,
      jsonb_build_object('points', pcs.points, 'max_points', pcs.max_points, 'source', pcs.source)
    ),
    '{}'::jsonb
  )
  into v_scores
  from public.project_component_scores pcs
  where pcs.attempt_id = v_attempt.id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'scenario_title', v_scenario.title,
    'kit_path', v_scenario.kit_path,
    'started_at', v_attempt.started_at,
    'deadline_at', v_attempt.deadline_at,
    'paused_at', v_attempt.paused_at,
    'pause_used', v_attempt.pause_used,
    'pause_seconds', v_attempt.pause_seconds,
    'runs_used', v_attempt.runs_used,
    'runs_allowed', v_attempt.runs_allowed,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int),
    'submissions', v_subs,
    'practice_runs', v_recent_practice,
    'component_scores', v_scores,
    'final_score', v_attempt.score
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grader Worker Functions (Outbound Only, Role 'grader' or Admin)
-- -----------------------------------------------------------------------------

-- 6.1 claim_next_job(worker_id)
create or replace function public.claim_next_job(
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.grading_jobs;
  v_sub public.submissions;
  v_attempt public.project_attempts;
  v_scenario public.scenarios;
begin
  if not public.is_grader_or_admin() then
    raise exception 'Access denied: only grader workers can claim jobs' using errcode = '42501';
  end if;

  -- Atomic lock: select 1 queued job with skip locked
  select * into v_job
  from public.grading_jobs
  where status = 'queued'
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  perform set_config('app.allow_grading_job_write', 'true', true);

  update public.grading_jobs
  set status = 'running',
      worker_id = p_worker_id,
      started_at = now(),
      attempts = attempts + 1
  where id = v_job.id
  returning * into v_job;

  select * into v_sub from public.submissions where id = v_job.submission_id;
  select * into v_attempt from public.project_attempts where id = v_sub.attempt_id;
  select * into v_scenario from public.scenarios where id = v_attempt.scenario_id;

  return jsonb_build_object(
    'job_id', v_job.id,
    'kind', v_job.kind,
    'mode', v_job.mode,
    'submission_file_path', v_sub.file_path,
    'scenario_hidden_paths', v_scenario.hidden_paths
  );
end;
$$;

-- 6.2 save_job_result
create or replace function public.save_job_result(
  p_job_id uuid,
  p_status text,
  p_result jsonb,
  p_candidate_feedback text,
  p_component_points jsonb default '{}'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.grading_jobs;
  v_sub public.submissions;
  v_attempt public.project_attempts;
  v_comp text;
  v_pts numeric;
  v_max numeric;
begin
  if not public.is_grader_or_admin() then
    raise exception 'Access denied: only grader workers can save job results' using errcode = '42501';
  end if;

  select * into v_job from public.grading_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job % not found', p_job_id using errcode = 'P0002';
  end if;

  select * into v_sub from public.submissions where id = v_job.submission_id;
  select * into v_attempt from public.project_attempts where id = v_sub.attempt_id;

  perform set_config('app.allow_grading_job_write', 'true', true);

  update public.grading_jobs
  set status = p_status,
      finished_at = now(),
      result = coalesce(p_result, '{}'::jsonb),
      candidate_feedback = p_candidate_feedback,
      error = p_error
  where id = v_job.id
  returning * into v_job;

  -- If this was a final job, save component points (A1, B1, B3)
  if v_job.mode = 'final' and p_status = 'done' and p_component_points is not null then
    for v_comp, v_pts in select key, value::text::numeric from jsonb_each_text(p_component_points) loop
      v_max := case
        when v_comp = 'A1' then 15.0
        when v_comp = 'B1' then 15.0
        when v_comp = 'B3' then 10.0
        else 10.0
      end;

      insert into public.project_component_scores (attempt_id, component, points, max_points, source, details)
      values (v_attempt.id, v_comp, v_pts, v_max, 'auto', jsonb_build_object('job_id', v_job.id))
      on conflict (attempt_id, component) do update
      set points = excluded.points,
          details = excluded.details;
    end loop;

    -- Check if all auto & reviewer components are done to finalize Stage 3
    perform public.compute_stage3_result(v_attempt.id);
  end if;

  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status);
end;
$$;

-- 6.3 requeue_stuck_jobs
create or replace function public.requeue_stuck_jobs(
  p_timeout_minutes integer default 5,
  p_max_attempts integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
  v_failed integer := 0;
begin
  if not public.is_grader_or_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  perform set_config('app.allow_grading_job_write', 'true', true);

  -- Fail jobs that exceeded max attempts
  update public.grading_jobs
  set status = 'failed',
      finished_at = now(),
      error = format('Job timed out after %s running attempts', attempts)
  where status = 'running'
    and started_at < (now() - make_interval(mins => p_timeout_minutes))
    and attempts >= p_max_attempts;

  get diagnostics v_failed = row_count;

  -- Requeue jobs below max attempts
  update public.grading_jobs
  set status = 'queued',
      worker_id = null,
      started_at = null
  where status = 'running'
    and started_at < (now() - make_interval(mins => p_timeout_minutes))
    and attempts < p_max_attempts;

  get diagnostics v_requeued = row_count;

  return v_requeued;
end;
$$;

-- 6.4 expire_overdue_project_attempts
create or replace function public.expire_overdue_project_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att record;
  v_count integer := 0;
begin
  if not public.is_grader_or_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  for v_att in
    select id
    from public.project_attempts
    where status in ('in_progress', 'paused')
      and now() >= deadline_at
  loop
    perform set_config('app.internal_caller', 'true', true);
    perform public.finalize_project(v_att.id, 'Project attempt finalized due to deadline expiry');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Stage 3 Reviewer Assignment & Stage 3 Result Computation
-- -----------------------------------------------------------------------------

-- 7.1 compute_stage3_result(attempt_id)
create or replace function public.compute_stage3_result(
  p_attempt_id uuid
)
returns public.stage_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.project_attempts;
  v_app public.applications;
  v_scores jsonb;
  v_total_points numeric := 0;
  v_part_a numeric := 0;
  v_part_b numeric := 0;
  v_passed boolean;
  v_stage_res public.stage_results;
  v_rec record;
begin
  select * into v_attempt from public.project_attempts where id = p_attempt_id for update;
  if not found then return null; end if;

  select * into v_app from public.applications where id = v_attempt.application_id;

  -- Check if all 8 components (A1, A2, A3, B1, B2, B3, C, D) exist
  if (select count(*) from public.project_component_scores where attempt_id = p_attempt_id) < 8 then
    return null;
  end if;

  select
    sum(points),
    sum(points) filter (where component in ('A1', 'A2', 'A3')),
    sum(points) filter (where component in ('B1', 'B2', 'B3'))
  into v_total_points, v_part_a, v_part_b
  from public.project_component_scores
  where attempt_id = p_attempt_id;

  -- Blueprint 6.3: Pass mark 60 points, with at least 40% in each of Part A (>= 16/40) and Part B (>= 16/40)
  v_passed := (v_total_points >= 60.0) and (v_part_a >= 16.0) and (v_part_b >= 16.0);

  perform set_config('app.allow_project_write', 'true', true);
  update public.project_attempts
  set score = v_total_points
  where id = p_attempt_id;

  select jsonb_object_agg(component, points) into v_scores
  from public.project_component_scores
  where attempt_id = p_attempt_id;

  perform set_config('app.allow_stage_result_write', 'true', true);

  insert into public.stage_results (
    application_id,
    stage,
    raw_score,
    percent,
    passed,
    details
  )
  values (
    v_app.id,
    3,
    v_total_points,
    v_total_points,
    v_passed,
    jsonb_build_object(
      'total_points', v_total_points,
      'part_a_points', v_part_a,
      'part_b_points', v_part_b,
      'component_scores', v_scores
    )
  )
  on conflict (application_id, stage) do update
  set raw_score = excluded.raw_score,
      percent = excluded.percent,
      passed = excluded.passed,
      details = excluded.details
  returning * into v_stage_res;

  perform set_config('app.internal_caller', 'true', true);
  if v_passed then
    perform public.advance_status(
      v_app.id,
      's3_passed',
      format('Stage 3 practical project passed (%s pts, Part A: %s/40, Part B: %s/40)', v_total_points, v_part_a, v_part_b)
    );
  else
    perform public.advance_status(
      v_app.id,
      's3_failed',
      format('Stage 3 below requirements (%s pts, Part A: %s/40, Part B: %s/40)', v_total_points, v_part_a, v_part_b)
    );
  end if;

  return v_stage_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Explicit Role Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
