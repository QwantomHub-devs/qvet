-- =============================================================================
-- Migration: 0007_qfellows_integration.sql
-- Description: Integration with Q-Fellows Portal
--   1. Extends applications with external_application_id & external_cohort_code
--   2. Adds outbound_webhooks table for transactional webhook outbox pattern
--   3. Automatically enqueues compliant webhook payloads on status changes & credential issuance
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend applications table for external Q-Fellows handoff
-- -----------------------------------------------------------------------------

alter table public.applications
  add column if not exists external_application_id uuid,
  add column if not exists external_cohort_code text;

-- Strict idempotency index: one vetting application per Q-Fellows external application ID
create unique index if not exists idx_applications_external_id
  on public.applications(external_application_id)
  where external_application_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Transactional Outbound Webhook Queue (Outbox Pattern)
-- -----------------------------------------------------------------------------

create table if not exists public.outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  event text not null check (event in (
    'application.registered',
    'application.approved',
    'stage.passed',
    'stage.failed',
    'credential.issued',
    'credential.revoked'
  )),
  idempotency_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  response_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outbound_webhooks_dispatch
  on public.outbound_webhooks(status, next_retry_at)
  where status in ('pending', 'failed');

create trigger trg_outbound_webhooks_updated_at
before update on public.outbound_webhooks
for each row execute function public.set_updated_at();

alter table public.outbound_webhooks enable row level security;
alter table public.outbound_webhooks force row level security;

-- Outbound webhooks table is strictly internal / admin only (Rule 3)
create policy outbound_webhooks_admin_service
  on public.outbound_webhooks for all
  to authenticated
  using (public.is_admin_or_service_role())
  with check (public.is_admin_or_service_role());

-- -----------------------------------------------------------------------------
-- 3. Queue Helper Function
-- -----------------------------------------------------------------------------

create or replace function public.queue_outbound_webhook(
  p_application_id uuid,
  p_event text,
  p_idempotency_key text,
  p_payload jsonb
)
returns public.outbound_webhooks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_webhook public.outbound_webhooks;
begin
  insert into public.outbound_webhooks (
    application_id,
    event,
    idempotency_key,
    payload,
    status,
    next_retry_at
  )
  values (
    p_application_id,
    p_event,
    p_idempotency_key,
    p_payload,
    'pending',
    now()
  )
  on conflict (idempotency_key) do update
  set payload = excluded.payload,
      updated_at = now()
  returning * into v_webhook;

  return v_webhook;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Automatic Webhook Enqueuing Trigger on Applications Status Changes
-- -----------------------------------------------------------------------------

create or replace function public.trg_fn_application_webhook_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.profiles;
  v_email text;
  v_inst public.institutions;
  v_inst_code text;
  v_event text;
  v_idemp_key text;
  v_payload jsonb;
  v_stage_num integer;
  v_stage_name text;
  v_stage_res public.stage_results;
  v_score numeric(5,2);
  v_passed boolean;
begin
  -- Only fire on actual status transition
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_prof from public.profiles where user_id = new.user_id;
  select email into v_email from auth.users where id = new.user_id;

  if v_prof.institution_id is not null then
    select * into v_inst from public.institutions where id = v_prof.institution_id;
    v_inst_code := coalesce(v_inst.partner_code, 'DIRECT');
  else
    v_inst_code := 'DIRECT';
  end if;

  -- 1. Status: approved (Government ID verified)
  if new.status = 'approved' then
    v_event := 'application.approved';
    v_idemp_key := 'evt_application.approved_' || new.id::text || '_' || new.status;
    v_payload := jsonb_build_object(
      'event', v_event,
      'idempotency_key', v_idemp_key,
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candidate', jsonb_build_object(
        'external_application_id', new.external_application_id,
        'vetting_application_id', new.id,
        'email', v_email,
        'full_name', v_prof.full_name,
        'institution_code', v_inst_code,
        'track_slug', new.track
      ),
      'stage_update', jsonb_build_object(
        'current_status', new.status,
        'stage_number', 0,
        'stage_name', 'identity_verification',
        'passed', true
      )
    );
    perform public.queue_outbound_webhook(new.id, v_event, v_idemp_key, v_payload);

  -- 2. Stage passed transitions: s1_passed, s2_passed, s3_passed, s4_passed
  elsif new.status in ('s1_passed', 's2_passed', 's3_passed', 's4_passed') then
    v_event := 'stage.passed';
    case new.status
      when 's1_passed' then v_stage_num := 1; v_stage_name := 'foundation_screen';
      when 's2_passed' then v_stage_num := 2; v_stage_name := 'technical_exam';
      when 's3_passed' then v_stage_num := 3; v_stage_name := 'practical_project';
      when 's4_passed' then v_stage_num := 4; v_stage_name := 'live_defence';
    end case;

    select * into v_stage_res from public.stage_results where application_id = new.id and stage = v_stage_num;
    v_score := coalesce(v_stage_res.percent, 0);

    v_idemp_key := 'evt_stage.passed_' || new.id::text || '_s' || v_stage_num || '_' || new.status;
    v_payload := jsonb_build_object(
      'event', v_event,
      'idempotency_key', v_idemp_key,
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candidate', jsonb_build_object(
        'external_application_id', new.external_application_id,
        'vetting_application_id', new.id,
        'email', v_email,
        'full_name', v_prof.full_name,
        'institution_code', v_inst_code,
        'track_slug', new.track
      ),
      'stage_update', jsonb_build_object(
        'current_status', new.status,
        'stage_number', v_stage_num,
        'stage_name', v_stage_name,
        'score', v_score,
        'passed', true,
        'retake_available_at', null,
        'details', coalesce(v_stage_res.details, '{}'::jsonb)
      )
    );
    perform public.queue_outbound_webhook(new.id, v_event, v_idemp_key, v_payload);

  -- 3. Stage failed transitions: retake_wait
  elsif new.status = 'retake_wait' then
    v_event := 'stage.failed';
    v_stage_num := old.current_stage;
    case v_stage_num
      when 1 then v_stage_name := 'foundation_screen';
      when 2 then v_stage_name := 'technical_exam';
      when 3 then v_stage_name := 'practical_project';
      when 4 then v_stage_name := 'live_defence';
      else v_stage_name := 'screening';
    end case;

    select * into v_stage_res from public.stage_results where application_id = new.id and stage = v_stage_num;
    v_score := coalesce(v_stage_res.percent, 0);

    v_idemp_key := 'evt_stage.failed_' || new.id::text || '_s' || v_stage_num || '_' || floor(extract(epoch from now()))::text;
    v_payload := jsonb_build_object(
      'event', v_event,
      'idempotency_key', v_idemp_key,
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candidate', jsonb_build_object(
        'external_application_id', new.external_application_id,
        'vetting_application_id', new.id,
        'email', v_email,
        'full_name', v_prof.full_name,
        'institution_code', v_inst_code,
        'track_slug', new.track
      ),
      'stage_update', jsonb_build_object(
        'current_status', new.status,
        'stage_number', v_stage_num,
        'stage_name', v_stage_name,
        'score', v_score,
        'passed', false,
        'retake_available_at', to_char(now() + interval '60 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'reapply_eligible_at', to_char(now() + interval '60 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'details', coalesce(v_stage_res.details, '{}'::jsonb)
      )
    );
    perform public.queue_outbound_webhook(new.id, v_event, v_idemp_key, v_payload);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_application_webhook_dispatcher on public.applications;
create trigger trg_application_webhook_dispatcher
after insert or update on public.applications
for each row execute function public.trg_fn_application_webhook_dispatcher();

-- -----------------------------------------------------------------------------
-- 5. Automatic Webhook Enqueuing Trigger on Credentials Issuance & Revocation
-- -----------------------------------------------------------------------------

create or replace function public.trg_fn_credential_webhook_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_prof public.profiles;
  v_email text;
  v_inst public.institutions;
  v_inst_code text;
  v_event text;
  v_idemp_key text;
  v_payload jsonb;
  v_scorecard jsonb;
  v_s1 public.stage_results;
  v_s2 public.stage_results;
  v_s3 public.stage_results;
  v_s4 public.stage_results;
  v_s4_booking public.stage4_bookings;
begin
  select * into v_app from public.applications where id = new.application_id;
  select * into v_prof from public.profiles where user_id = v_app.user_id;
  select email into v_email from auth.users where id = v_app.user_id;

  if v_prof.institution_id is not null then
    select * into v_inst from public.institutions where id = v_prof.institution_id;
    v_inst_code := coalesce(v_inst.partner_code, 'DIRECT');
  else
    v_inst_code := 'DIRECT';
  end if;

  -- 1. Credential Revoked
  if new.revoked = true and (old is null or old.revoked = false) then
    v_event := 'credential.revoked';
    v_idemp_key := 'evt_credential.revoked_' || new.verify_code || '_' || floor(extract(epoch from now()))::text;
    v_payload := jsonb_build_object(
      'event', v_event,
      'idempotency_key', v_idemp_key,
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candidate', jsonb_build_object(
        'external_application_id', v_app.external_application_id,
        'vetting_application_id', v_app.id,
        'email', v_email,
        'full_name', v_prof.full_name,
        'institution_code', v_inst_code,
        'track_slug', v_app.track
      ),
      'credential', jsonb_build_object(
        'verify_code', new.verify_code,
        'status', 'revoked',
        'revoked_at', to_char(coalesce(new.revoked_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'revoked_reason', new.revoked_reason
      )
    );
    perform public.queue_outbound_webhook(v_app.id, v_event, v_idemp_key, v_payload);

  -- 2. Credential Issued
  elsif new.revoked = false and (old is null or old.verify_code is distinct from new.verify_code) then
    v_event := 'credential.issued';
    v_idemp_key := 'evt_credential.issued_' || new.verify_code || '_v1';

    select * into v_s1 from public.stage_results where application_id = v_app.id and stage = 1;
    select * into v_s2 from public.stage_results where application_id = v_app.id and stage = 2;
    select * into v_s3 from public.stage_results where application_id = v_app.id and stage = 3;
    select * into v_s4 from public.stage_results where application_id = v_app.id and stage = 4;
    select * into v_s4_booking from public.stage4_bookings where application_id = v_app.id order by scheduled_at desc limit 1;

    v_scorecard := jsonb_build_object(
      'overall_score', new.overall,
      'tier', new.tier,
      'weights_applied', jsonb_build_object('s1', 0.15, 's2', 0.25, 's3', 0.35, 's4', 0.25),
      'stages', jsonb_build_object(
        's1_foundation', jsonb_build_object(
          'score', coalesce(v_s1.percent, 0),
          'communication_rating', coalesce((v_s1.details->>'communication_rating')::numeric, 4.0)
        ),
        's2_exam', jsonb_build_object(
          'score', coalesce(v_s2.percent, 0),
          'domain_breakdown', coalesce(v_s2.details->'domains', '{}'::jsonb)
        ),
        's3_project', jsonb_build_object(
          'score', coalesce(v_s3.percent, 0),
          'part_a_score', coalesce((v_s3.details->>'part_a_score')::numeric, 0),
          'part_b_score', coalesce((v_s3.details->>'part_b_score')::numeric, 0),
          'summary', coalesce(v_s3.details->>'summary', 'Practical engineering project passed benchmarks.'),
          'tools_used', coalesce(v_s3.details->'tools_used', '["Python", "Git"]'::jsonb)
        ),
        's4_defence', jsonb_build_object(
          'score', coalesce(v_s4.percent, 0),
          'rubric_avg', coalesce((v_s4.details->>'rubric_avg')::numeric, 3.5),
          'understanding_of_work', coalesce((v_s4.details->>'understanding_of_work')::int, 4),
          'reviewer_summary', coalesce(v_s4_booking.notes, 'Demonstrated clear technical rationale.')
        )
      )
    );

    v_payload := jsonb_build_object(
      'event', v_event,
      'idempotency_key', v_idemp_key,
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candidate', jsonb_build_object(
        'external_application_id', v_app.external_application_id,
        'vetting_application_id', v_app.id,
        'email', v_email,
        'full_name', v_prof.full_name,
        'institution_code', v_inst_code,
        'track_slug', v_app.track,
        'availability', coalesce(v_app.track_metadata->>'availability', 'full_time')
      ),
      'scorecard', v_scorecard,
      'credential', jsonb_build_object(
        'verify_code', new.verify_code,
        'issued_at', to_char(new.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'expires_at', to_char(new.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status', 'valid'
      )
    );

    perform public.queue_outbound_webhook(v_app.id, v_event, v_idemp_key, v_payload);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_credential_webhook_dispatcher on public.credentials;
create trigger trg_credential_webhook_dispatcher
after insert or update on public.credentials
for each row execute function public.trg_fn_credential_webhook_dispatcher();
