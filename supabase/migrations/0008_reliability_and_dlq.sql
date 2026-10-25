-- =============================================================================
-- Migration: 0008_reliability_and_dlq.sql
-- Description: Platform Reliability, DLQ, Idempotent Retries & Telemetry
--   1. Grading jobs DLQ support ('dead_letter' status, max attempts)
--   2. Client request idempotency on practice runs
--   3. Exam answer retry idempotency
--   4. Admin re-drive RPCs for webhooks and grading jobs
--   5. Circuit breaker settings configuration
--   6. Platform-wide telemetry analytics function
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Grading Jobs DLQ & Client Request Idempotency
-- -----------------------------------------------------------------------------

-- Expand status check constraint to include 'dead_letter'
alter table public.grading_jobs drop constraint if exists grading_jobs_status_check;
alter table public.grading_jobs add constraint grading_jobs_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'dead_letter'));

-- Add client_request_id and max_attempts if not present
alter table public.grading_jobs
  add column if not exists client_request_id text,
  add column if not exists max_attempts integer not null default 3;

create index if not exists idx_grading_jobs_client_req
  on public.grading_jobs(submission_id, client_request_id)
  where client_request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Idempotent Practice Run Request
-- -----------------------------------------------------------------------------

drop function if exists public.request_practice_run(uuid, text);
drop function if exists public.request_practice_run(uuid, text, text);

create or replace function public.request_practice_run(
  p_attempt_id uuid,
  p_part text,
  p_client_request_id text default null
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
  v_existing_job public.grading_jobs;
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

  -- Idempotency check: if client_request_id provided and already queued/running/done, return existing job
  if p_client_request_id is not null and btrim(p_client_request_id) <> '' then
    select * into v_existing_job
    from public.grading_jobs
    where submission_id = v_sub.id
      and client_request_id = btrim(p_client_request_id);

    if found then
      return jsonb_build_object(
        'job_id', v_existing_job.id,
        'kind', v_existing_job.kind,
        'mode', v_existing_job.mode,
        'status', v_existing_job.status,
        'runs_used', v_attempt.runs_used,
        'runs_allowed', v_attempt.runs_allowed,
        'idempotent', true
      );
    end if;
  end if;

  if v_attempt.runs_used >= v_attempt.runs_allowed then
    raise exception 'Practice run limit reached (% of % runs used)', v_attempt.runs_used, v_attempt.runs_allowed
      using errcode = '23514';
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
    status,
    client_request_id
  )
  values (
    v_sub.id,
    v_job_kind,
    'practice',
    'queued',
    nullif(btrim(coalesce(p_client_request_id, '')), '')
  )
  returning * into v_job;

  return jsonb_build_object(
    'job_id', v_job.id,
    'kind', v_job.kind,
    'mode', v_job.mode,
    'status', v_job.status,
    'runs_used', v_attempt.runs_used,
    'runs_allowed', v_attempt.runs_allowed,
    'idempotent', false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Idempotent Exam Answer Submission
-- -----------------------------------------------------------------------------

create or replace function public.submit_answer(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.exam_attempts;
  v_app public.applications;
  v_total integer;
  v_expected_qid uuid;
  v_new_index integer;
  v_stage_res public.stage_results;
  v_existing_ans public.exam_answers;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.exam_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Exam attempt not found' using errcode = 'P0002';
  end if;

  select * into v_app
  from public.applications
  where id = v_attempt.application_id;

  if v_app.user_id <> v_uid then
    raise exception 'Access denied to exam attempt' using errcode = '42501';
  end if;

  -- Idempotency check: did the client already successfully submit and lock this exact answer?
  select * into v_existing_ans
  from public.exam_answers
  where attempt_id = p_attempt_id
    and question_id = p_question_id
    and locked = true
    and answer = btrim(p_answer);

  if found then
    return jsonb_build_object(
      'attempt_id', p_attempt_id,
      'locked', true,
      'finished', (v_attempt.status in ('submitted', 'auto_submitted')),
      'success', true,
      'idempotent', true,
      'current_index', v_attempt.current_index,
      'total_questions', coalesce(array_length(v_attempt.question_ids, 1), 0),
      'completed', (v_attempt.status in ('submitted', 'auto_submitted')),
      'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int)
    );
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'Cannot submit answer: exam attempt is already %', v_attempt.status
      using errcode = '23514';
  end if;

  -- Server-enforced deadline check: if expired, auto-submit existing answers and reject this late answer
  if now() > v_attempt.deadline_at then
    perform set_config('app.internal_caller', 'true', true);
    perform public.finish_exam(p_attempt_id);
    raise exception 'Exam deadline has passed; attempt has been auto-submitted'
      using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(p_answer, '')), '') is null then
    raise exception 'Answer cannot be empty' using errcode = '22023';
  end if;

  v_total := coalesce(array_length(v_attempt.question_ids, 1), 0);
  if v_attempt.current_index >= v_total then
    raise exception 'All questions in this attempt have already been answered' using errcode = '23514';
  end if;

  v_expected_qid := v_attempt.question_ids[v_attempt.current_index + 1];
  if p_question_id is distinct from v_expected_qid then
    raise exception 'Question % does not match the current active question index % (no backtracking or skipping)',
      p_question_id, v_attempt.current_index
      using errcode = '23514';
  end if;

  perform set_config('app.allow_exam_answer_write', 'true', true);

  insert into public.exam_answers (
    attempt_id,
    question_id,
    question_index,
    answer,
    answered_at,
    locked
  )
  values (
    p_attempt_id,
    p_question_id,
    v_attempt.current_index,
    p_answer,
    now(),
    true
  );

  v_new_index := v_attempt.current_index + 1;

  perform set_config('app.allow_exam_attempt_write', 'true', true);

  update public.exam_attempts
  set current_index = v_new_index
  where id = p_attempt_id;

  -- If this was the last question, auto-finish and score
  if v_new_index >= v_total then
    perform set_config('app.internal_caller', 'true', true);
    v_stage_res := public.finish_exam(p_attempt_id);
    return jsonb_build_object(
      'attempt_id', p_attempt_id,
      'locked', true,
      'finished', true,
      'success', true,
      'idempotent', false,
      'current_index', v_new_index,
      'total_questions', v_total,
      'completed', true,
      'stage_result', to_jsonb(v_stage_res)
    );
  end if;

  return jsonb_build_object(
    'attempt_id', p_attempt_id,
    'locked', true,
    'finished', false,
    'success', true,
    'idempotent', false,
    'current_index', v_new_index,
    'total_questions', v_total,
    'completed', false,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now()))))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Grader Worker Stalled Recovery with DLQ Enforcement
-- -----------------------------------------------------------------------------

drop function if exists public.requeue_stuck_jobs(integer, integer);
drop function if exists public.requeue_stuck_jobs();

create or replace function public.requeue_stuck_jobs(
  p_timeout_minutes integer default 5,
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
  v_dead_lettered integer := 0;
begin
  if not public.is_grader_or_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  perform set_config('app.allow_grading_job_write', 'true', true);

  -- 1. Dead-letter jobs that exceeded max attempts
  update public.grading_jobs
  set status = 'dead_letter',
      finished_at = now(),
      error = format('Job exceeded max attempts (%s attempts). Isolated to DLQ for review.', attempts)
  where status = 'running'
    and started_at < (now() - make_interval(mins => p_timeout_minutes))
    and attempts >= p_max_attempts;

  get diagnostics v_dead_lettered = row_count;

  -- 2. Requeue remaining jobs below max attempts
  update public.grading_jobs
  set status = 'queued',
      worker_id = null,
      started_at = null
  where status = 'running'
    and started_at < (now() - make_interval(mins => p_timeout_minutes))
    and attempts < p_max_attempts;

  get diagnostics v_requeued = row_count;

  return jsonb_build_object(
    'requeued', v_requeued,
    'dead_lettered', v_dead_lettered
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Admin Re-drive RPCs for Webhooks and Grading Jobs
-- -----------------------------------------------------------------------------

create or replace function public.admin_redrive_webhooks(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied: admin privilege required' using errcode = '42501';
  end if;

  update public.outbound_webhooks
  set status = 'pending',
      attempts = 0,
      next_retry_at = now(),
      last_error = null,
      updated_at = now()
  where id = any(p_ids)
    and status in ('failed', 'dead_letter');

  get diagnostics v_count = row_count;

  insert into public.audit_log (actor, action, entity, entity_id, after)
  values (
    auth.uid(),
    'admin_redrive_webhooks',
    'outbound_webhooks',
    null,
    jsonb_build_object('count', v_count, 'ids', p_ids)
  );

  return v_count;
end;
$$;

create or replace function public.admin_redrive_grading_jobs(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied: admin privilege required' using errcode = '42501';
  end if;

  perform set_config('app.allow_grading_job_write', 'true', true);

  update public.grading_jobs
  set status = 'queued',
      attempts = 0,
      worker_id = null,
      started_at = null,
      finished_at = null,
      error = null,
      updated_at = now()
  where id = any(p_ids)
    and status in ('failed', 'dead_letter');

  get diagnostics v_count = row_count;

  insert into public.audit_log (actor, action, entity, entity_id, after)
  values (
    auth.uid(),
    'admin_redrive_grading_jobs',
    'grading_jobs',
    null,
    jsonb_build_object('count', v_count, 'ids', p_ids)
  );

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Circuit Breaker Configuration in Settings
-- -----------------------------------------------------------------------------

insert into public.settings (key, value)
values (
  'circuit_breaker_qfellows',
  '{
    "state": "CLOSED",
    "failure_count": 0,
    "last_failure_at": null,
    "last_error": null,
    "cooldown_seconds": 300,
    "failure_threshold": 5
  }'::jsonb
)
on conflict (key) do nothing;

create or replace function public.admin_reset_circuit_breaker(p_key text default 'circuit_breaker_qfellows')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_val jsonb;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied: admin privilege required' using errcode = '42501';
  end if;

  v_new_val := jsonb_build_object(
    'state', 'CLOSED',
    'failure_count', 0,
    'last_failure_at', null,
    'last_error', null,
    'cooldown_seconds', 300,
    'failure_threshold', 5
  );

  update public.settings
  set value = v_new_val,
      updated_at = now()
  where key = p_key;

  insert into public.audit_log (actor, action, entity, entity_id, after)
  values (
    auth.uid(),
    'admin_reset_circuit_breaker',
    'settings',
    null,
    jsonb_build_object('key', p_key)
  );

  return v_new_val;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Platform Telemetry Analytics Function
-- -----------------------------------------------------------------------------

create or replace function public.get_platform_telemetry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funnel jsonb;
  v_tracks jsonb;
  v_tiers jsonb;
  v_averages jsonb;
  v_webhooks jsonb;
  v_grader jsonb;
  v_cb jsonb;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  -- 1. Funnel Stages
  select jsonb_build_object(
    'total_registered', count(*),
    'id_pending', count(*) filter (where status = 'id_pending'),
    'id_approved', count(*) filter (where status in ('approved', 's1_open', 's1_passed', 's2_open', 's2_passed', 's3_open', 's3_grading', 's3_review', 's3_passed', 's4_scheduled', 's4_done', 's4_passed', 'certified')),
    's1_passed', count(*) filter (where status in ('s1_passed', 's2_open', 's2_passed', 's3_open', 's3_grading', 's3_review', 's3_passed', 's4_scheduled', 's4_done', 's4_passed', 'certified')),
    's2_passed', count(*) filter (where status in ('s2_passed', 's3_open', 's3_grading', 's3_review', 's3_passed', 's4_scheduled', 's4_done', 's4_passed', 'certified')),
    's3_passed', count(*) filter (where status in ('s3_passed', 's4_scheduled', 's4_done', 's4_passed', 'certified')),
    's4_passed', count(*) filter (where status in ('s4_passed', 'certified')),
    'certified', count(*) filter (where status = 'certified'),
    'retake_wait', count(*) filter (where status = 'retake_wait'),
    'rejected', count(*) filter (where status = 'rejected')
  )
  into v_funnel
  from public.applications;

  -- 2. Tracks Breakdown
  select jsonb_build_object(
    'ai', count(*) filter (where track = 'ai'),
    'iot', count(*) filter (where track = 'iot'),
    'robotics', count(*) filter (where track = 'robotics')
  )
  into v_tracks
  from public.applications;

  -- 3. Tiers Breakdown
  select jsonb_build_object(
    'elite', count(*) filter (where tier = 'elite'),
    'certified_pro', count(*) filter (where tier = 'certified_pro'),
    'certified', count(*) filter (where tier = 'certified'),
    'revoked', count(*) filter (where revoked = true)
  )
  into v_tiers
  from public.credentials;

  -- 4. Average Scores
  select jsonb_build_object(
    's1_avg', coalesce(round(avg(percent) filter (where stage = 1), 1), 0),
    's2_avg', coalesce(round(avg(percent) filter (where stage = 2), 1), 0),
    's3_avg', coalesce(round(avg(percent) filter (where stage = 3), 1), 0),
    's4_avg', coalesce(round(avg(percent) filter (where stage = 4), 1), 0)
  )
  into v_averages
  from public.stage_results;

  -- 5. Outbound Webhook Queue Depths
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'delivered', count(*) filter (where status = 'delivered'),
    'failed', count(*) filter (where status = 'failed'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'total', count(*)
  )
  into v_webhooks
  from public.outbound_webhooks;

  -- 6. Grader Queue Depths
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'running', count(*) filter (where status = 'running'),
    'done', count(*) filter (where status = 'done'),
    'failed', count(*) filter (where status = 'failed'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'total', count(*)
  )
  into v_grader
  from public.grading_jobs;

  -- 7. Circuit Breaker State
  select value into v_cb from public.settings where key = 'circuit_breaker_qfellows';

  return jsonb_build_object(
    'funnel', v_funnel,
    'tracks', v_tracks,
    'tiers', v_tiers,
    'averages', v_averages,
    'webhooks', v_webhooks,
    'grader', v_grader,
    'circuit_breaker', coalesce(v_cb, '{}'::jsonb),
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;
