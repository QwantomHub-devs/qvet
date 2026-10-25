-- =============================================================================
-- Migration: 0006_security_hardening.sql
-- Description: Security Audit Remediations (SEC-01 & SEC-04)
--   1. Tightens RLS on submissions & project storage for reviewers (Rule 10 blind separation)
--   2. Clicks & integrity event spam protection (max 100 events per attempt)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SEC-01: Restrict submissions and project storage RLS for reviewers
-- -----------------------------------------------------------------------------

-- Drop old broad policies on public.submissions
drop policy if exists submissions_select on public.submissions;

create policy submissions_select on public.submissions
  for select to authenticated
  using (
    -- Candidate reads own submissions
    (
      public.current_user_role() = 'candidate'
      and exists (
        select 1 from public.project_attempts pa
        join public.applications a on a.id = pa.application_id
        where pa.id = submissions.attempt_id and a.user_id = auth.uid()
      )
    )
    -- Grader workers and admins have full system read access
    or public.is_grader_or_admin()
    -- Reviewers can ONLY read submissions if they are assigned to review them
    -- or assigned to candidate's Stage 4 live defence booking
    or (
      public.current_user_role() = 'reviewer'
      and (
        exists (
          select 1 from public.review_assignments ra
          where ra.reviewer_id = auth.uid()
            and ra.submission_id = submissions.id
        )
        or exists (
          select 1 from public.stage4_bookings sb
          join public.project_attempts pa on pa.application_id = sb.application_id
          where sb.reviewer_id = auth.uid()
            and pa.id = submissions.attempt_id
            and sb.status in ('scheduled', 'completed')
        )
      )
    )
  );

-- Drop old broad policy on storage.objects for project-submissions
drop policy if exists storage_project_submissions_candidate_select on storage.objects;

create policy storage_project_submissions_candidate_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-submissions'
    and (
      -- Candidate reads own submission files
      (public.current_user_role() = 'candidate' and split_part(name, '/', 1) = auth.uid()::text)
      -- Grader workers and admins
      or public.is_grader_or_admin()
      -- Reviewers only if explicitly assigned to the attempt's review or Stage 4 defence
      or (
        public.current_user_role() = 'reviewer'
        and exists (
          select 1 from public.submissions s
          join public.project_attempts pa on pa.id = s.attempt_id
          where s.file_path = storage.objects.name
            and (
              exists (
                select 1 from public.review_assignments ra
                where ra.reviewer_id = auth.uid()
                  and ra.submission_id = s.id
              )
              or exists (
                select 1 from public.stage4_bookings sb
                where sb.reviewer_id = auth.uid()
                  and sb.application_id = pa.application_id
                  and sb.status in ('scheduled', 'completed')
              )
            )
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. SEC-04: Cap integrity events to 100 per exam attempt to prevent storage bloat
-- -----------------------------------------------------------------------------

create or replace function public.log_integrity_event(
  p_attempt_id uuid,
  p_type text,
  p_meta jsonb default '{}'::jsonb
)
returns public.integrity_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.exam_attempts;
  v_app public.applications;
  v_evt public.integrity_events;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_type not in ('tab_hidden', 'fullscreen_exit', 'flagged_similarity', 'late_paste') then
    raise exception 'Invalid integrity event type: %', p_type using errcode = '22023';
  end if;

  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  -- Enforce rate-limit / quota: maximum 100 integrity events per exam attempt
  select count(*) into v_count
  from public.integrity_events
  where attempt_ref = p_attempt_id;

  if v_count >= 100 then
    -- Silently drop or return the latest event to prevent denial-of-service storage exhaustion
    select * into v_evt
    from public.integrity_events
    where attempt_ref = p_attempt_id
    order by at desc
    limit 1;
    return v_evt;
  end if;

  insert into public.integrity_events (
    attempt_ref,
    application_id,
    type,
    at,
    meta
  )
  values (
    p_attempt_id,
    v_app.id,
    p_type,
    now(),
    coalesce(p_meta, '{}'::jsonb)
  )
  returning * into v_evt;

  return v_evt;
end;
$$;

