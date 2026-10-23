-- =============================================================================
-- Milestone 1 (M1): Foundation
-- Tables: settings, institutions, cohorts, profiles, applications, id_documents, audit_log
-- Includes: RLS policies (deny by default), storage bucket & policies,
-- status machine (advance_status), onboarding & admin verification RPCs.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Utility trigger for updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- 2.1 settings (Runtime configuration per Rule 9 of AGENTS.md)
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_settings_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

alter table public.settings enable row level security;
alter table public.settings force row level security;

-- 2.2 institutions
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text not null,
  partner_code text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_institutions_updated_at
before update on public.institutions
for each row execute function public.set_updated_at();

alter table public.institutions enable row level security;
alter table public.institutions force row level security;

-- 2.3 cohorts
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  institution_id uuid references public.institutions(id) on delete set null,
  track text not null check (track in ('ai', 'iot', 'robotics')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_cohorts_updated_at
before update on public.cohorts
for each row execute function public.set_updated_at();

alter table public.cohorts enable row level security;
alter table public.cohorts force row level security;

-- 2.4 profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'candidate' check (role in ('candidate', 'reviewer', 'admin')),
  full_name text not null default '',
  country text,
  institution_id uuid references public.institutions(id) on delete set null,
  other_institution_name text,
  phone text,
  github_url text,
  years_experience numeric(4,1) check (years_experience is null or (years_experience >= 0 and years_experience <= 60)),
  self_declared_strengths text,
  time_zone text,
  weekly_availability_hours integer check (weekly_availability_hours is null or (weekly_availability_hours >= 1 and weekly_availability_hours <= 168)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enforce uniqueness on normalized phone and github_url when present (Stage 0 duplicate prevention)
create unique index idx_profiles_phone_unique
  on public.profiles ((regexp_replace(phone, '[^0-9+]', '', 'g')))
  where phone is not null and btrim(phone) <> '';

create unique index idx_profiles_github_url_unique
  on public.profiles ((lower(rtrim(btrim(github_url), '/'))))
  where github_url is not null and btrim(github_url) <> '';

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- 2.5 applications (One active track application per candidate)
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  track text not null check (track in ('ai', 'iot', 'robotics')),
  cohort_id uuid references public.cohorts(id) on delete set null,
  status text not null default 'registered' check (
    status in (
      'registered',
      'id_pending',
      'approved',
      'rejected',
      's1_open',
      's1_passed',
      's1_failed',
      's2_open',
      's2_passed',
      's2_failed',
      's3_open',
      's3_grading',
      's3_review',
      's3_passed',
      's3_failed',
      's4_scheduled',
      's4_done',
      's4_passed',
      's4_failed',
      'certified',
      'expired',
      'retake_wait'
    )
  ),
  current_stage integer not null default 0 check (current_stage >= 0 and current_stage <= 4),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  track_metadata jsonb not null default '{}'::jsonb,
  consent_at timestamptz not null,
  consent_version text not null default 'v1.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_applications_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

alter table public.applications enable row level security;
alter table public.applications force row level security;

-- 2.6 id_documents (Private storage metadata, admin verification record)
create table public.id_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  storage_path text not null unique,
  document_number_hash text not null,
  name_on_id text not null,
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  is_current boolean not null default true,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  decision text check (decision is null or decision in ('approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_id_documents_application_id on public.id_documents(application_id);

create trigger trg_id_documents_updated_at
before update on public.id_documents
for each row execute function public.set_updated_at();

alter table public.id_documents enable row level security;
alter table public.id_documents force row level security;

-- 2.7 audit_log (Immutable log of status changes, admin ID reads, role changes)
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_audit_log_entity on public.audit_log(entity, entity_id);
create index idx_audit_log_at on public.audit_log(at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- -----------------------------------------------------------------------------
-- 3. Role Helper Functions (Security Definer)
-- -----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

-- -----------------------------------------------------------------------------
-- 4. Protection Triggers (Defense-in-Depth)
-- -----------------------------------------------------------------------------

-- 4.1 Automatically create a candidate profile when an auth.users row is created
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
  -- Only trust raw_app_meta_data (service_role/seed), never client-supplied raw_user_meta_data for roles
  v_role := coalesce(nullif(new.raw_app_meta_data->>'role', ''), 'candidate');
  if v_role not in ('candidate', 'reviewer', 'admin') then
    v_role := 'candidate';
  end if;

  v_full_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), '');

  insert into public.profiles (user_id, role, full_name)
  values (new.id, v_role, v_full_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4.2 Prevent non-admins from mutating profile.role or profile.user_id
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Cannot modify profile user_id' using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if coalesce(current_setting('app.allow_role_update', true), '') <> 'true'
       and current_user not in ('postgres', 'service_role')
       and not public.is_admin() then
      raise exception 'Insufficient privilege to change user role' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_protect_profile_columns
before update on public.profiles
for each row execute function public.protect_profile_columns();

-- 4.3 Prevent any direct status/score/stage mutation on applications outside advance_status
create or replace function public.protect_application_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.allow_application_insert', true), '') <> 'true'
       and current_user not in ('postgres', 'service_role') then
      raise exception 'Applications must be created via submit_onboarding' using errcode = '42501';
    end if;
    if new.status <> 'registered' or new.current_stage <> 0 or new.score is not null then
      raise exception 'New applications must start in registered status at stage 0 with null score' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Cannot change application owner' using errcode = '42501';
    end if;

    if (new.status is distinct from old.status) or (new.current_stage is distinct from old.current_stage) then
      if coalesce(current_setting('app.allow_status_update', true), '') <> 'true' then
        raise exception 'All status changes must go through advance_status()' using errcode = '42501';
      end if;
    end if;

    if new.score is distinct from old.score then
      if coalesce(current_setting('app.allow_score_update', true), '') <> 'true' then
        raise exception 'Application score can only be updated by server scoring functions' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_protect_application_columns
before insert or update on public.applications
for each row execute function public.protect_application_columns();

-- 4.4 Make audit_log strictly append-only
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is immutable and cannot be updated or deleted' using errcode = '42501';
end;
$$;

create trigger trg_audit_log_immutable
before update or delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security Policies (Section 5.2 of platform-design.md)
-- -----------------------------------------------------------------------------

-- 5.1 settings policies
create policy settings_select_authenticated
  on public.settings for select
  to authenticated
  using (true);

create policy settings_admin_write
  on public.settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5.2 institutions policies
create policy institutions_select_authenticated
  on public.institutions for select
  to authenticated
  using (active = true or public.is_admin());

create policy institutions_admin_write
  on public.institutions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5.3 cohorts policies
create policy cohorts_select_authenticated
  on public.cohorts for select
  to authenticated
  using (true);

create policy cohorts_admin_write
  on public.cohorts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5.4 profiles policies
-- Candidates and reviewers can only read their own profile (reviewers never see candidate names/institutions)
-- Admins can read all profiles
create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy profiles_update_own_or_admin
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy profiles_admin_insert
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy profiles_admin_delete
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- 5.5 applications policies
-- Candidate can read ONLY their own application. Reviewers cannot read applications directly. Admins read all.
-- No direct client INSERT/UPDATE/DELETE policies on applications (must use server RPCs).
create policy applications_select_own_or_admin
  on public.applications for select
  to authenticated
  using (
    (user_id = auth.uid() and public.current_user_role() = 'candidate')
    or public.is_admin()
  );

-- 5.6 id_documents policies
-- Candidate can read their own ID document metadata. Admin can read all. Reviewer cannot read any.
-- Writes happen only through record_id_upload and admin_verify_id RPCs.
create policy id_documents_select_own_or_admin
  on public.id_documents for select
  to authenticated
  using (
    (
      public.current_user_role() = 'candidate'
      and exists (
        select 1 from public.applications a
        where a.id = id_documents.application_id
          and a.user_id = auth.uid()
      )
    )
    or public.is_admin()
  );

-- 5.7 audit_log policies
-- Only admin can read audit_log; no direct client writes allowed.
create policy audit_log_select_admin_only
  on public.audit_log for select
  to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. Private Storage Bucket & Policies for ID Documents
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'id-documents',
  'id-documents',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Candidates may upload an ID object only into their own folder (`{user_id}/{application_id}/{filename}`)
-- when their application is in `registered` or `rejected` status.
drop policy if exists id_docs_candidate_insert on storage.objects;
create policy id_docs_candidate_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'id-documents'
    and public.current_user_role() = 'candidate'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.applications a
      where a.user_id = auth.uid()
        and a.id::text = (storage.foldername(name))[2]
        and a.status in ('registered', 'rejected')
    )
  );

-- Direct client SELECT on storage.objects in id-documents is denied so that
-- even admins must go through the logged server action (log_admin_id_view + service_role signed URL).

-- -----------------------------------------------------------------------------
-- 7. Business Logic Functions (RPCs)
-- -----------------------------------------------------------------------------

-- 7.1 advance_status: Single entry point for all application status changes
create or replace function public.advance_status(
  p_application_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_updated public.applications;
  v_old_status text;
  v_old_stage integer;
  v_new_stage integer;
  v_is_valid boolean := false;
begin
  -- Verify caller authorization: only internal server functions, admins, or postgres/service_role
  if coalesce(current_setting('app.internal_caller', true), '') <> 'true'
     and not public.is_admin()
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Candidates and reviewers cannot call advance_status directly'
      using errcode = '42501';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Application % not found', p_application_id
      using errcode = 'P0002';
  end if;

  v_old_status := v_app.status;
  v_old_stage := v_app.current_stage;

  -- Validate transition against Section 2.4 state machine
  case v_old_status
    when 'registered' then
      v_is_valid := p_new_status in ('id_pending');
    when 'id_pending' then
      v_is_valid := p_new_status in ('approved', 'rejected');
    when 'rejected' then
      -- Candidate can upload a new ID to return to id_pending
      v_is_valid := p_new_status in ('id_pending');
    when 'approved' then
      v_is_valid := p_new_status in ('s1_open');
    when 's1_open' then
      v_is_valid := p_new_status in ('s1_passed', 's1_failed');
    when 's1_passed' then
      v_is_valid := p_new_status in ('s2_open');
    when 's1_failed' then
      v_is_valid := p_new_status in ('retake_wait');
    when 's2_open' then
      v_is_valid := p_new_status in ('s2_passed', 's2_failed');
    when 's2_passed' then
      v_is_valid := p_new_status in ('s3_open');
    when 's2_failed' then
      v_is_valid := p_new_status in ('retake_wait');
    when 's3_open' then
      v_is_valid := p_new_status in ('s3_grading');
    when 's3_grading' then
      v_is_valid := p_new_status in ('s3_review', 's3_passed', 's3_failed');
    when 's3_review' then
      v_is_valid := p_new_status in ('s3_passed', 's3_failed');
    when 's3_passed' then
      v_is_valid := p_new_status in ('s4_scheduled');
    when 's3_failed' then
      v_is_valid := p_new_status in ('retake_wait');
    when 's4_scheduled' then
      v_is_valid := p_new_status in ('s4_done');
    when 's4_done' then
      v_is_valid := p_new_status in ('s4_passed', 's4_failed');
    when 's4_passed' then
      v_is_valid := p_new_status in ('certified', 'retake_wait');
    when 's4_failed' then
      v_is_valid := p_new_status in ('retake_wait');
    when 'certified' then
      v_is_valid := p_new_status in ('expired');
    when 'retake_wait' then
      v_is_valid := p_new_status in ('s1_open', 's2_open', 's3_open', 's4_scheduled');
    else
      v_is_valid := false;
  end case;

  if not v_is_valid then
    raise exception 'Illegal status transition from % to %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  -- Compute current_stage automatically (auto-advances stage pointer upon approval)
  v_new_stage := case
    when p_new_status in ('registered', 'id_pending', 'rejected') then 0
    when p_new_status in ('approved', 's1_open', 's1_passed', 's1_failed') then 1
    when p_new_status in ('s2_open', 's2_passed', 's2_failed') then 2
    when p_new_status in ('s3_open', 's3_grading', 's3_review', 's3_passed', 's3_failed') then 3
    when p_new_status in ('s4_scheduled', 's4_done', 's4_passed', 's4_failed', 'certified', 'expired') then 4
    when p_new_status = 'retake_wait' then v_old_stage
    else v_old_stage
  end;

  perform set_config('app.allow_status_update', 'true', true);

  update public.applications
  set status = p_new_status,
      current_stage = v_new_stage
  where id = p_application_id
  returning * into v_updated;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'status_change',
    'applications',
    p_application_id,
    jsonb_build_object('status', v_old_status, 'current_stage', v_old_stage),
    jsonb_build_object('status', v_updated.status, 'current_stage', v_updated.current_stage, 'reason', p_reason)
  );

  return v_updated;
end;
$$;

-- 7.2 submit_onboarding: Stage 0 profile & application creation with duplicate checks
create or replace function public.submit_onboarding(
  p_full_name text,
  p_country text,
  p_phone text,
  p_github_url text,
  p_years_experience numeric,
  p_self_declared_strengths text,
  p_time_zone text,
  p_weekly_availability_hours integer,
  p_institution_id uuid,
  p_other_institution_name text,
  p_track text,
  p_cohort_id uuid,
  p_track_metadata jsonb,
  p_consent boolean
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_norm_phone text;
  v_norm_github text;
  v_app public.applications;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if public.current_user_role() <> 'candidate' then
    raise exception 'Only candidates can submit an onboarding application' using errcode = '42501';
  end if;

  if coalesce(p_consent, false) is not true then
    raise exception 'You must consent to data processing and employer profile sharing to apply' using errcode = '22023';
  end if;

  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Full name is required' using errcode = '22023';
  end if;

  if nullif(btrim(p_country), '') is null then
    raise exception 'Country is required' using errcode = '22023';
  end if;

  v_norm_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if length(v_norm_phone) < 7 then
    raise exception 'A valid phone number is required' using errcode = '22023';
  end if;

  v_norm_github := lower(rtrim(btrim(coalesce(p_github_url, '')), '/'));
  if v_norm_github !~ '^https?://[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' then
    raise exception 'A valid GitHub or portfolio URL (starting with http:// or https://) is required' using errcode = '22023';
  end if;

  if p_years_experience is null or p_years_experience < 0 or p_years_experience > 60 then
    raise exception 'Years of experience must be between 0 and 60' using errcode = '22023';
  end if;

  if nullif(btrim(p_self_declared_strengths), '') is null then
    raise exception 'Self-declared strengths are required' using errcode = '22023';
  end if;

  if nullif(btrim(p_time_zone), '') is null then
    raise exception 'Time zone is required' using errcode = '22023';
  end if;

  if p_weekly_availability_hours is null or p_weekly_availability_hours < 1 or p_weekly_availability_hours > 168 then
    raise exception 'Weekly availability must be between 1 and 168 hours' using errcode = '22023';
  end if;

  if p_institution_id is null and nullif(btrim(p_other_institution_name), '') is null then
    raise exception 'Please select your institution or specify an Other / Independent name' using errcode = '22023';
  end if;

  if p_institution_id is not null then
    if not exists (select 1 from public.institutions where id = p_institution_id and active = true) then
      raise exception 'Selected institution is not active or does not exist' using errcode = '22023';
    end if;
  end if;

  if p_track not in ('ai', 'iot', 'robotics') then
    raise exception 'Track must be ai, iot, or robotics' using errcode = '22023';
  end if;

  -- Enforce duplicate checks across profiles (phone & GitHub/portfolio URL)
  if exists (
    select 1 from public.profiles
    where user_id <> v_uid
      and phone is not null
      and regexp_replace(phone, '[^0-9+]', '', 'g') = v_norm_phone
  ) then
    raise exception 'Duplicate account detected: this phone number is already registered'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.profiles
    where user_id <> v_uid
      and github_url is not null
      and lower(rtrim(btrim(github_url), '/')) = v_norm_github
  ) then
    raise exception 'Duplicate account detected: this GitHub or portfolio link is already registered'
      using errcode = '23505';
  end if;

  -- Enforce single track application per candidate
  if exists (select 1 from public.applications where user_id = v_uid) then
    raise exception 'You already have an active application. Candidates may apply to only one track at a time.'
      using errcode = '23505';
  end if;

  -- Update candidate profile
  update public.profiles
  set full_name = btrim(p_full_name),
      country = btrim(p_country),
      phone = btrim(p_phone),
      github_url = btrim(p_github_url),
      years_experience = p_years_experience,
      self_declared_strengths = btrim(p_self_declared_strengths),
      time_zone = btrim(p_time_zone),
      weekly_availability_hours = p_weekly_availability_hours,
      institution_id = p_institution_id,
      other_institution_name = case when p_institution_id is null then btrim(p_other_institution_name) else null end
  where user_id = v_uid;

  -- Create application in registered status
  perform set_config('app.allow_application_insert', 'true', true);

  insert into public.applications (
    user_id,
    track,
    cohort_id,
    status,
    current_stage,
    track_metadata,
    consent_at,
    consent_version
  )
  values (
    v_uid,
    p_track,
    p_cohort_id,
    'registered',
    0,
    coalesce(p_track_metadata, '{}'::jsonb),
    now(),
    'v1.0'
  )
  returning * into v_app;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'onboarding_submitted',
    'applications',
    v_app.id,
    null,
    jsonb_build_object('track', v_app.track, 'status', v_app.status, 'institution_id', p_institution_id)
  );

  return v_app;
end;
$$;

-- 7.3 record_id_upload: Validates ID match & uniqueness, records ID document, transitions to id_pending
create or replace function public.record_id_upload(
  p_application_id uuid,
  p_storage_path text,
  p_file_size_bytes integer,
  p_mime_type text,
  p_document_number text,
  p_name_on_id text
)
returns public.id_documents
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.applications;
  v_profile public.profiles;
  v_norm_profile_name text;
  v_norm_id_name text;
  v_norm_doc_num text;
  v_doc_hash text;
  v_max_bytes integer;
  v_doc public.id_documents;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  if v_app.status not in ('registered', 'rejected') then
    raise exception 'ID upload is only permitted when application status is registered or rejected (current: %)', v_app.status
      using errcode = '23514';
  end if;

  select * into v_profile
  from public.profiles
  where user_id = v_uid;

  -- Automatic check 1: Name on ID matches candidate's full name
  v_norm_profile_name := lower(regexp_replace(btrim(coalesce(v_profile.full_name, '')), '\s+', ' ', 'g'));
  v_norm_id_name := lower(regexp_replace(btrim(coalesce(p_name_on_id, '')), '\s+', ' ', 'g'));

  if v_norm_id_name = '' or v_norm_id_name <> v_norm_profile_name then
    raise exception 'Name on ID (%) does not match your registered full name (%)', btrim(p_name_on_id), v_profile.full_name
      using errcode = '22023';
  end if;

  -- Automatic check 2: No duplicate Government ID number across accounts
  v_norm_doc_num := lower(regexp_replace(btrim(coalesce(p_document_number, '')), '[^a-zA-Z0-9]', '', 'g'));
  if length(v_norm_doc_num) < 4 then
    raise exception 'A valid government ID number is required' using errcode = '22023';
  end if;

  v_doc_hash := encode(digest(v_norm_doc_num, 'sha256'), 'hex');

  if exists (
    select 1
    from public.id_documents d
    join public.applications a on a.id = d.application_id
    where d.document_number_hash = v_doc_hash
      and a.user_id <> v_uid
  ) then
    raise exception 'Duplicate account detected: this government ID document has already been used by another account'
      using errcode = '23505';
  end if;

  -- Validate file size against runtime settings
  select coalesce((value->>'bytes')::integer, 5242880)
  into v_max_bytes
  from public.settings
  where key = 'max_id_upload_bytes';

  v_max_bytes := coalesce(v_max_bytes, 5242880);

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > v_max_bytes then
    raise exception 'ID document file size must be between 1 byte and % bytes', v_max_bytes
      using errcode = '22023';
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Unsupported ID document file type: %', p_mime_type
      using errcode = '22023';
  end if;

  if nullif(btrim(p_storage_path), '') is null
     or split_part(p_storage_path, '/', 1) <> v_uid::text
     or split_part(p_storage_path, '/', 2) <> p_application_id::text then
    raise exception 'Invalid storage path for ID document'
      using errcode = '22023';
  end if;

  -- Mark previous ID documents for this application as not current
  update public.id_documents
  set is_current = false
  where application_id = p_application_id
    and is_current = true;

  insert into public.id_documents (
    application_id,
    storage_path,
    document_number_hash,
    name_on_id,
    file_size_bytes,
    mime_type,
    is_current
  )
  values (
    p_application_id,
    p_storage_path,
    v_doc_hash,
    btrim(p_name_on_id),
    p_file_size_bytes,
    p_mime_type,
    true
  )
  returning * into v_doc;

  -- Transition status to id_pending via advance_status
  perform set_config('app.internal_caller', 'true', true);
  perform public.advance_status(p_application_id, 'id_pending', 'Candidate uploaded government ID');

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'id_document_uploaded',
    'id_documents',
    v_doc.id,
    null,
    jsonb_build_object('application_id', p_application_id, 'storage_path', p_storage_path, 'mime_type', p_mime_type)
  );

  return v_doc;
end;
$$;

-- 7.4 admin_verify_id: Admin approves or rejects an uploaded ID
create or replace function public.admin_verify_id(
  p_application_id uuid,
  p_decision text,
  p_reason text default null
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.id_documents;
  v_app public.applications;
begin
  if not public.is_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'Only administrators can verify ID documents' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  if p_decision = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection reason is required when rejecting an ID document' using errcode = '22023';
  end if;

  select * into v_doc
  from public.id_documents
  where application_id = p_application_id
    and is_current = true
  for update;

  if not found then
    raise exception 'No current ID document found for application %', p_application_id
      using errcode = 'P0002';
  end if;

  update public.id_documents
  set verified_by = auth.uid(),
      verified_at = now(),
      decision = p_decision,
      rejection_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end
  where id = v_doc.id;

  perform set_config('app.internal_caller', 'true', true);
  v_app := public.advance_status(
    p_application_id,
    p_decision,
    coalesce(nullif(btrim(p_reason), ''), 'Admin verified ID document: ' || p_decision)
  );

  return v_app;
end;
$$;

-- 7.5 log_admin_id_view: Mandatory audit log entry before generating a short-lived signed URL
create or replace function public.log_admin_id_view(
  p_id_document_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.id_documents;
begin
  if not public.is_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'Only administrators can view ID documents' using errcode = '42501';
  end if;

  select * into v_doc
  from public.id_documents
  where id = p_id_document_id;

  if not found then
    raise exception 'ID document % not found', p_id_document_id using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'id_document_viewed',
    'id_documents',
    v_doc.id,
    null,
    jsonb_build_object(
      'application_id', v_doc.application_id,
      'storage_path', v_doc.storage_path
    )
  );

  return v_doc.storage_path;
end;
$$;

-- 7.6 admin_set_user_role: Admin role management RPC
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
  if not public.is_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'Only administrators can change user roles' using errcode = '42501';
  end if;

  if p_new_role not in ('candidate', 'reviewer', 'admin') then
    raise exception 'Invalid role: %', p_new_role using errcode = '22023';
  end if;

  select role into v_old_role
  from public.profiles
  where user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'Profile for user % not found', p_target_user_id using errcode = 'P0002';
  end if;

  perform set_config('app.allow_role_update', 'true', true);

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

-- 7.7 admin_upsert_institution: Admin portal institution management RPC
create or replace function public.admin_upsert_institution(
  p_id uuid,
  p_name text,
  p_country text,
  p_partner_code text,
  p_active boolean default true
)
returns public.institutions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.institutions;
  v_before jsonb := null;
begin
  if not public.is_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'Only administrators can manage institutions' using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null or nullif(btrim(p_country), '') is null then
    raise exception 'Institution name and country are required' using errcode = '22023';
  end if;

  if p_id is not null then
    select to_jsonb(i.*) into v_before from public.institutions i where i.id = p_id;
    update public.institutions
    set name = btrim(p_name),
        country = btrim(p_country),
        partner_code = nullif(btrim(p_partner_code), ''),
        active = coalesce(p_active, true)
    where id = p_id
    returning * into v_inst;
  else
    insert into public.institutions (name, country, partner_code, active)
    values (
      btrim(p_name),
      btrim(p_country),
      nullif(btrim(p_partner_code), ''),
      coalesce(p_active, true)
    )
    returning * into v_inst;
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    case when v_before is null then 'institution_created' else 'institution_updated' end,
    'institutions',
    v_inst.id,
    v_before,
    to_jsonb(v_inst)
  );

  return v_inst;
end;
$$;
