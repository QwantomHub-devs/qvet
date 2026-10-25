-- =============================================================================
-- Migration 0005: Milestone 5 - Results, Credentials, and Stage 4 Live Defence
--
-- 1. stage4_bookings table (meeting URL, scheduled time, status, reviewer)
-- 2. credentials table (tier, overall score, verify_code, 24-month expiry, revocation)
-- 3. Stage 4 rubric criteria seeding into rubric_criteria
-- 4. RPCs:
--    - book_stage4_defence: scheduling and blind reviewer conflict check
--    - submit_stage4_review: 5-criterion rubric scoring, automatic fail check, Stage 4 result
--    - compute_overall: weights, stage minimums, tier threshold math from settings
--    - admin_issue_credential: random verify_code, credential creation, advances to certified
--    - admin_revoke_credential: revokes credential with logged reason
--    - get_public_credential_verification: strict public endpoint leaking zero PII
--    - get_employer_scorecard: verified employer scorecard view
-- 5. Row Level Security on all new tables and functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. stage4_bookings
-- -----------------------------------------------------------------------------

create table if not exists public.stage4_bookings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  scheduled_at timestamptz not null,
  meeting_url text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists idx_stage4_bookings_application on public.stage4_bookings(application_id);
create index if not exists idx_stage4_bookings_reviewer on public.stage4_bookings(reviewer_id, status);

create trigger trg_stage4_bookings_updated_at
before update on public.stage4_bookings
for each row execute function public.set_updated_at();

alter table public.stage4_bookings enable row level security;
alter table public.stage4_bookings force row level security;

-- -----------------------------------------------------------------------------
-- 2. credentials
-- -----------------------------------------------------------------------------

create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  tier text not null check (tier in ('certified', 'certified_pro', 'elite')),
  overall numeric(5,2) not null check (overall >= 0 and overall <= 100),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verify_code text not null unique,
  revoked boolean not null default false,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists idx_credentials_verify_code on public.credentials(verify_code);
create index if not exists idx_credentials_application on public.credentials(application_id);

create trigger trg_credentials_updated_at
before update on public.credentials
for each row execute function public.set_updated_at();

alter table public.credentials enable row level security;
alter table public.credentials force row level security;

-- -----------------------------------------------------------------------------
-- 3. Link booking_id column to review_assignments if not present
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'review_assignments'
      and column_name = 'booking_id'
  ) then
    alter table public.review_assignments
      add column booking_id uuid references public.stage4_bookings(id) on delete cascade;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Seed Stage 4 Defence Rubric & Criteria
-- -----------------------------------------------------------------------------

do $$
declare
  v_rubric_id uuid;
begin
  -- Insert or select the Stage 4 rubric for AI/All tracks
  insert into public.rubrics (stage, part, track, title, description, active)
  values (
    4,
    's4_defence',
    'all',
    'Stage 4 Live Technical Defence Rubric',
    'Five-criterion live defence rubric: understanding of own work, fundamentals depth, live problem solving, communication, and honesty/professionalism. Each scored 1 to 4.',
    true
  )
  on conflict (stage, part, track) do update
  set title = excluded.title,
      description = excluded.description,
      active = true
  returning id into v_rubric_id;

  if v_rubric_id is null then
    select id into v_rubric_id
    from public.rubrics
    where stage = 4 and part = 's4_defence' and track = 'all';
  end if;

  -- 1. Understanding of own work
  insert into public.rubric_criteria (rubric_id, slug, criterion, weight, scale_min, scale_max, sort_order, anchors)
  values (
    v_rubric_id,
    'understanding_own_work',
    'Understanding of own work',
    1.00,
    1,
    4,
    1,
    jsonb_build_object(
      '1', 'Cannot explain submitted code (automatic fail signal for borrowed or AI-generated work)',
      '2', 'Explains parts only; struggles with end-to-end architectural rationale',
      '3', 'Explains all main decisions clearly and accurately',
      '4', 'Explains decisions, trade-offs, and alternative approaches considered'
    )
  )
  on conflict (rubric_id, slug) do update
  set criterion = excluded.criterion,
      anchors = excluded.anchors,
      sort_order = excluded.sort_order;

  -- 2. Fundamentals depth
  insert into public.rubric_criteria (rubric_id, slug, criterion, weight, scale_min, scale_max, sort_order, anchors)
  values (
    v_rubric_id,
    'fundamentals_depth',
    'Fundamentals depth',
    1.00,
    1,
    4,
    2,
    jsonb_build_object(
      '1', 'Major foundational gaps on core machine learning / software principles',
      '2', 'Surface knowledge; struggles when probed on underlying mechanics',
      '3', 'Solid understanding of engineering and ML foundations',
      '4', 'Deep, intuitive knowledge; articulates concepts clearly enough to teach them'
    )
  )
  on conflict (rubric_id, slug) do update
  set criterion = excluded.criterion,
      anchors = excluded.anchors,
      sort_order = excluded.sort_order;

  -- 3. Live problem solving
  insert into public.rubric_criteria (rubric_id, slug, criterion, weight, scale_min, scale_max, sort_order, anchors)
  values (
    v_rubric_id,
    'live_problem_solving',
    'Live problem solving',
    1.00,
    1,
    4,
    3,
    jsonb_build_object(
      '1', 'Stuck immediately when prompt or constraints are altered',
      '2', 'Needs heavy reviewer hinting and direction to make progress',
      '3', 'Adapts to changes with light reviewer guidance and sound logic',
      '4', 'Solves modifications independently, reasons aloud, and validates own solution'
    )
  )
  on conflict (rubric_id, slug) do update
  set criterion = excluded.criterion,
      anchors = excluded.anchors,
      sort_order = excluded.sort_order;

  -- 4. Communication
  insert into public.rubric_criteria (rubric_id, slug, criterion, weight, scale_min, scale_max, sort_order, anchors)
  values (
    v_rubric_id,
    'communication',
    'Communication',
    1.00,
    1,
    4,
    4,
    jsonb_build_object(
      '1', 'Hard to follow, disjointed explanations, or unresponsive to questions',
      '2', 'Understandable with effort; occasionally rambles or misinterprets queries',
      '3', 'Clear, structured explanations and active listening',
      '4', 'Clear, concise, highly structured; effortlessly adapts detail to the listener'
    )
  )
  on conflict (rubric_id, slug) do update
  set criterion = excluded.criterion,
      anchors = excluded.anchors,
      sort_order = excluded.sort_order;

  -- 5. Honesty and professionalism
  insert into public.rubric_criteria (rubric_id, slug, criterion, weight, scale_min, scale_max, sort_order, anchors)
  values (
    v_rubric_id,
    'honesty_professionalism',
    'Honesty and professionalism',
    1.00,
    1,
    4,
    5,
    jsonb_build_object(
      '1', 'Bluffs or pretends when unsure; combative or evasive',
      '2', 'Defensive about shortcomings; reluctant to acknowledge errors',
      '3', 'Admits limits honestly and explains how they would verify',
      '4', 'Exemplary honesty; acknowledges limits candidly and outlines practical verification steps'
    )
  )
  on conflict (rubric_id, slug) do update
  set criterion = excluded.criterion,
      anchors = excluded.anchors,
      sort_order = excluded.sort_order;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security Policies
-- -----------------------------------------------------------------------------

-- 5.1 stage4_bookings policies
-- Candidates can read only their own booking
-- Assigned reviewer can read their assigned booking
-- Admins can read and write all bookings
create policy stage4_bookings_select_policy
  on public.stage4_bookings for select
  to authenticated
  using (
    reviewer_id = auth.uid()
    or exists (
      select 1 from public.applications a
      where a.id = stage4_bookings.application_id
        and a.user_id = auth.uid()
    )
    or public.is_admin()
  );

create policy stage4_bookings_admin_all
  on public.stage4_bookings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5.2 credentials policies
-- Candidates can read only their own credential
-- Public access is routed through get_public_credential_verification
-- Admins can manage all credentials
create policy credentials_select_policy
  on public.credentials for select
  to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = credentials.application_id
        and a.user_id = auth.uid()
    )
    or public.is_admin()
  );

create policy credentials_admin_all
  on public.credentials for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. Update advance_status to support Stage 4 transitions and certified
-- -----------------------------------------------------------------------------

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
  -- Caller authorization: internal server functions, admins, or service_role
  if coalesce(current_setting('app.internal_caller', true), '') <> 'true'
     and not public.is_admin_or_service_role() then
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
      v_is_valid := p_new_status in ('s3_open', 's3_grading', 's3_timed_out', 'retake_wait');
    when 's3_grading' then
      v_is_valid := p_new_status in ('s3_review', 's3_passed', 's3_failed');
    when 's3_review' then
      v_is_valid := p_new_status in ('s3_passed', 's3_failed');
    when 's3_passed' then
      v_is_valid := p_new_status in ('s4_scheduled');
    when 's3_failed' then
      v_is_valid := p_new_status in ('retake_wait');
    when 's4_scheduled' then
      v_is_valid := p_new_status in ('s4_scheduled', 's4_done', 's4_passed', 's4_failed');
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

  -- Compute current_stage automatically
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
    jsonb_build_object('status', v_old_status, 'stage', v_old_stage),
    jsonb_build_object('status', p_new_status, 'stage', v_new_stage, 'reason', p_reason)
  );

  return v_updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Stage 4 Booking Function
-- -----------------------------------------------------------------------------

create or replace function public.book_stage4_defence(
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_meeting_url text,
  p_reviewer_id uuid default null,
  p_notes text default null
)
returns public.stage4_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_cand_inst uuid;
  v_reviewer_id uuid := p_reviewer_id;
  v_rev record;
  v_booking public.stage4_bookings;
  v_caller_role text := public.current_user_role();
begin
  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Application % not found', p_application_id using errcode = 'P0002';
  end if;

  select institution_id into v_cand_inst
  from public.profiles
  where user_id = v_app.user_id;

  -- Must be candidate owning the application or admin
  if v_caller_role <> 'admin' and v_app.user_id <> auth.uid() then
    raise exception 'Access denied to application %', p_application_id using errcode = '42501';
  end if;

  -- Application must be in s3_passed (or s4_scheduled if rescheduling)
  if v_app.status not in ('s3_passed', 's4_scheduled') then
    raise exception 'Application % is not ready for Stage 4 defence (status: %)', p_application_id, v_app.status
      using errcode = '23514';
  end if;

  if p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'Defence interview must be scheduled for a future time' using errcode = '22023';
  end if;

  if p_meeting_url is null or length(btrim(p_meeting_url)) < 8 or p_meeting_url !~* '^https?://' then
    raise exception 'A valid meeting URL (e.g. Google Meet or Jitsi) is required' using errcode = '22023';
  end if;

  -- Select reviewer if not provided
  if v_reviewer_id is null then
    select p.user_id into v_reviewer_id
    from public.profiles p
    left join public.stage4_bookings sb on sb.reviewer_id = p.user_id and sb.status = 'scheduled'
    where p.role = 'reviewer'
      -- Non-negotiable Rule 10: Never assign a reviewer from the candidate's own institution
      and (v_cand_inst is null or p.institution_id is null or p.institution_id <> v_cand_inst)
    group by p.user_id
    order by count(sb.id) asc, random()
    limit 1;

    if v_reviewer_id is null then
      raise exception 'No eligible non-conflicting reviewer available for Stage 4' using errcode = 'P0002';
    end if;
  else
    -- Verify explicitly specified reviewer
    select p.institution_id into v_rev
    from public.profiles p
    where p.user_id = v_reviewer_id and p.role = 'reviewer';

    if not found then
      raise exception 'Specified user % is not an active reviewer', v_reviewer_id using errcode = '23514';
    end if;

    if v_cand_inst is not null and v_rev.institution_id is not null and v_rev.institution_id = v_cand_inst then
      raise exception 'Conflict of interest: reviewer cannot be assigned candidate from their own institution'
        using errcode = '42501';
    end if;
  end if;

  -- Insert or update stage4_bookings
  insert into public.stage4_bookings (
    application_id,
    reviewer_id,
    scheduled_at,
    meeting_url,
    status,
    notes
  )
  values (
    p_application_id,
    v_reviewer_id,
    p_scheduled_at,
    p_meeting_url,
    'scheduled',
    p_notes
  )
  on conflict (application_id) do update
  set reviewer_id = excluded.reviewer_id,
    scheduled_at = excluded.scheduled_at,
    meeting_url = excluded.meeting_url,
    status = 'scheduled',
    notes = excluded.notes,
    completed_at = null
  returning * into v_booking;

  -- Create or update corresponding review_assignments entry for reviewer console
  perform set_config('app.allow_review_write', 'true', true);

  -- Delete existing pending review assignment if rescheduling
  delete from public.review_assignments
  where application_id = p_application_id
    and stage = 4
    and part = 's4_defence'
    and status = 'assigned';

  insert into public.review_assignments (
    application_id,
    stage,
    part,
    reviewer_id,
    review_round,
    is_second_review,
    is_third_review,
    status,
    due_at,
    booking_id
  )
  values (
    p_application_id,
    4,
    's4_defence',
    v_reviewer_id,
    1,
    false,
    false,
    'assigned',
    p_scheduled_at + interval '24 hours',
    v_booking.id
  );

  -- Advance status to s4_scheduled
  perform set_config('app.internal_caller', 'true', true);
  if v_app.status <> 's4_scheduled' then
    perform public.advance_status(
      p_application_id,
      's4_scheduled',
      format('Live defence scheduled for %s', p_scheduled_at)
    );
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'stage4_booked',
    'stage4_bookings',
    v_booking.id,
    null,
    jsonb_build_object(
      'application_id', p_application_id,
      'reviewer_id', v_reviewer_id,
      'scheduled_at', p_scheduled_at,
      'meeting_url', p_meeting_url
    )
  );

  return v_booking;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Enhanced get_reviewer_queue (Supports Stage 4 Defence Bookings)
-- -----------------------------------------------------------------------------

create or replace function public.get_reviewer_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.current_user_role();
  if v_role not in ('reviewer', 'admin') then
    raise exception 'Only reviewers and admins can access the review queue' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'assignment_id', ra.id,
        'stage', ra.stage,
        'part', ra.part,
        'review_round', ra.review_round,
        'is_second_review', ra.is_second_review,
        'is_third_review', ra.is_third_review,
        'status', ra.status,
        'avg_score', ra.avg_score,
        'due_at', ra.due_at,
        'submitted_at', ra.submitted_at,
        -- Blind anonymous candidate identifier (never exposes full_name or institution)
        'anonymous_candidate_ref', 'CAND-' || upper(substr(encode(extensions.digest(a.id::text, 'sha256'), 'hex'), 1, 8)),
        'track', a.track,
        'response_id', r.id,
        'response_kind', coalesce(r.kind, 'defence'),
        'response_text', r.text,
        'word_count', r.word_count,
        'storage_path', r.storage_path,
        'mime_type', r.mime_type,
        'duration_seconds', r.duration_seconds,
        'response_submitted_at', r.submitted_at,
        'booking_id', sb.id,
        'meeting_url', sb.meeting_url,
        'scheduled_at', sb.scheduled_at,
        'prompt_title', coalesce(p.title, case when ra.stage = 4 then 'Stage 4 Live Technical Defence' else 'Assessment Item' end),
        'prompt_text', coalesce(
          p.prompt_text,
          case when ra.stage = 4
            then '40-minute live technical defence call. Candidate walks through Stage 3 submission, answers probing questions on decisions and trade-offs, and reasons through a live problem modification.'
            else 'Review candidate deliverable according to the rubric criteria.'
          end
        ),
        'rubric', (
          select jsonb_build_object(
            'id', rub.id,
            'title', rub.title,
            'description', rub.description,
            'criteria', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', rc.id,
                    'slug', rc.slug,
                    'criterion', rc.criterion,
                    'weight', rc.weight,
                    'scale_min', rc.scale_min,
                    'scale_max', rc.scale_max,
                    'anchors', rc.anchors,
                    'sort_order', rc.sort_order
                  )
                  order by rc.sort_order asc
                )
                from public.rubric_criteria rc
                where rc.rubric_id = rub.id
              ),
              '[]'::jsonb
            )
          )
          from public.rubrics rub
          where rub.stage = ra.stage
            and rub.part = ra.part
            and rub.track in (a.track, 'all')
            and rub.active = true
          order by (case when rub.track = a.track then 0 else 1 end)
          limit 1
        ),
        'my_scores', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'criterion_id', rs.criterion_id,
                'score', rs.score,
                'comment', rs.comment
              )
            )
            from public.review_scores rs
            where rs.assignment_id = ra.id
          ),
          '[]'::jsonb
        ),
        'peer_reviews', case
          when ra.status = 'submitted' or v_role = 'admin' then coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'assignment_id', peer_ra.id,
                  'review_round', peer_ra.review_round,
                  'avg_score', peer_ra.avg_score,
                  'submitted_at', peer_ra.submitted_at
                )
                order by peer_ra.review_round asc
              )
              from public.review_assignments peer_ra
              where peer_ra.response_id = ra.response_id
                and peer_ra.id <> ra.id
                and peer_ra.status = 'submitted'
            ),
            '[]'::jsonb
          )
          else '[]'::jsonb
        end
      )
      order by (case when ra.status = 'assigned' then 0 else 1 end), ra.due_at asc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.review_assignments ra
  join public.applications a on a.id = ra.application_id
  left join public.responses r on r.id = ra.response_id
  left join public.prompts p on p.id = r.prompt_id
  left join public.stage4_bookings sb on sb.id = ra.booking_id or (ra.stage = 4 and sb.application_id = ra.application_id)
  where (v_role = 'admin' or ra.reviewer_id = v_uid)
    and ra.status <> 'cancelled';

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8b. Unified submit_review Supporting Stage 1 and Stage 4
-- -----------------------------------------------------------------------------

create or replace function public.submit_review(
  p_assignment_id uuid,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ra public.review_assignments;
  v_booking public.stage4_bookings;
begin
  select * into v_ra
  from public.review_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'Review assignment % not found', p_assignment_id using errcode = 'P0002';
  end if;

  if v_ra.stage = 4 then
    select * into v_booking
    from public.stage4_bookings
    where id = v_ra.booking_id or application_id = v_ra.application_id
    order by created_at desc
    limit 1;

    if not found then
      raise exception 'Stage 4 booking not found for assignment %', p_assignment_id using errcode = 'P0002';
    end if;

    return public.submit_stage4_review(v_booking.id, p_scores, null);
  end if;

  -- Fallback to standard Stage 1 review logic
  return public.submit_stage1_review_internal(p_assignment_id, p_scores);
end;
$$;

-- Rename original submit_review logic as internal helper if needed
create or replace function public.submit_stage1_review_internal(
  p_assignment_id uuid,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ra public.review_assignments;
  v_app public.applications;
  v_rubric_id uuid;
  v_expected_criteria integer := 0;
  v_scored_criteria integer := 0;
  v_item jsonb;
  v_crit_id uuid;
  v_score integer;
  v_comment text;
  v_my_avg numeric(4,2);
  v_submitted_scores numeric[];
  v_submitted_count integer := 0;
  v_total_assignments integer := 0;
  v_diff numeric(4,2);
  v_third_review_triggered boolean := false;
  v_final_avg numeric(4,2);
  v_final_pct numeric(5,2);
  v_stage1_result public.stage_results;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_ra
  from public.review_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'Review assignment % not found', p_assignment_id using errcode = 'P0002';
  end if;

  if v_ra.reviewer_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied to review assignment %', p_assignment_id using errcode = '42501';
  end if;

  if v_ra.status = 'submitted' then
    raise exception 'Review assignment has already been submitted and locked' using errcode = '23514';
  end if;

  select * into v_app from public.applications where id = v_ra.application_id;

  select rub.id into v_rubric_id
  from public.rubrics rub
  where rub.stage = v_ra.stage
    and rub.part = v_ra.part
    and rub.track in (v_app.track, 'all')
    and rub.active = true
  order by (case when rub.track = v_app.track then 0 else 1 end)
  limit 1;

  if v_rubric_id is null then
    raise exception 'Active rubric not found for stage % part %', v_ra.stage, v_ra.part using errcode = 'P0002';
  end if;

  select count(*)::int into v_expected_criteria
  from public.rubric_criteria
  where rubric_id = v_rubric_id;

  if jsonb_typeof(p_scores) <> 'array' then
    raise exception 'p_scores must be a JSON array of criterion scores' using errcode = '22023';
  end if;

  perform set_config('app.allow_review_write', 'true', true);

  for v_item in select * from jsonb_array_elements(p_scores) loop
    v_crit_id := (v_item->>'criterion_id')::uuid;
    v_score := (v_item->>'score')::int;
    v_comment := nullif(btrim(coalesce(v_item->>'comment', '')), '');

    if v_score is null or v_score < 1 or v_score > 4 then
      raise exception 'Each rubric criterion score must be an integer between 1 and 4' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.rubric_criteria rc
      where rc.id = v_crit_id and rc.rubric_id = v_rubric_id
    ) then
      raise exception 'Criterion % does not belong to rubric %', v_crit_id, v_rubric_id using errcode = '22023';
    end if;

    insert into public.review_scores (assignment_id, criterion_id, score, comment)
    values (p_assignment_id, v_crit_id, v_score, v_comment)
    on conflict (assignment_id, criterion_id) do update
    set score = excluded.score,
        comment = excluded.comment;
  end loop;

  select count(*)::int, round(avg(score)::numeric, 2)
  into v_scored_criteria, v_my_avg
  from public.review_scores
  where assignment_id = p_assignment_id;

  if v_scored_criteria < v_expected_criteria then
    raise exception 'All % rubric criteria must be scored before submitting (received %)',
      v_expected_criteria, v_scored_criteria
      using errcode = '22023';
  end if;

  update public.review_assignments
  set status = 'submitted',
      avg_score = v_my_avg,
      submitted_at = now()
  where id = p_assignment_id
  returning * into v_ra;

  -- Evaluate agreement across reviewers for this response
  if v_ra.response_id is not null then
    select
      array_agg(ra.avg_score order by ra.review_round asc, ra.submitted_at asc) filter (where ra.status = 'submitted'),
      count(*) filter (where ra.status = 'submitted')::int,
      count(*) filter (where ra.status <> 'cancelled')::int
    into v_submitted_scores, v_submitted_count, v_total_assignments
    from public.review_assignments ra
    where ra.response_id = v_ra.response_id;

    if v_submitted_count = 2 and v_total_assignments = 2 then
      v_diff := abs(v_submitted_scores[1] - v_submitted_scores[2]);
      if v_diff > 1.0 then
        perform public.assign_reviewers_for_response(v_ra.response_id, 1, true);
        v_third_review_triggered := true;
      else
        v_final_avg := round((v_submitted_scores[1] + v_submitted_scores[2]) / 2.0, 2);
      end if;
    elsif v_submitted_count >= 3 then
      if abs(v_submitted_scores[3] - v_submitted_scores[1]) < abs(v_submitted_scores[3] - v_submitted_scores[2]) then
        v_final_avg := round((v_submitted_scores[3] + v_submitted_scores[1]) / 2.0, 2);
      elsif abs(v_submitted_scores[3] - v_submitted_scores[2]) < abs(v_submitted_scores[3] - v_submitted_scores[1]) then
        v_final_avg := round((v_submitted_scores[3] + v_submitted_scores[2]) / 2.0, 2);
      else
        v_final_avg := round((v_submitted_scores[1] + v_submitted_scores[2] + v_submitted_scores[3]) / 3.0, 2);
      end if;
    end if;

    if v_final_avg is not null then
      v_final_pct := round(((v_final_avg - 1.0) / 3.0) * 100.0, 2);

      perform set_config('app.allow_response_write', 'true', true);
      update public.responses
      set final_rubric_avg = v_final_avg,
          final_percent = v_final_pct
      where id = v_ra.response_id;

      v_stage1_result := public.compute_stage1_result(v_ra.application_id);
    end if;
  end if;

  return jsonb_build_object(
    'assignment_id', v_ra.id,
    'avg_score', v_my_avg,
    'third_review_triggered', v_third_review_triggered,
    'final_rubric_avg', v_final_avg,
    'final_percent', v_final_pct,
    'stage1_result', to_jsonb(v_stage1_result)
  );
end;
$$;

create or replace function public.submit_stage4_review(
  p_booking_id uuid,
  p_scores jsonb, -- array of {"criterion_id": uuid, "score": int, "comment": text}
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.stage4_bookings;
  v_app public.applications;
  v_ra public.review_assignments;
  v_rubric_id uuid;
  v_expected_criteria integer := 5;
  v_item jsonb;
  v_crit_id uuid;
  v_score integer;
  v_crit_comment text;
  v_crit_slug text;
  v_understanding_score integer;
  v_sum_score integer := 0;
  v_count_score integer := 0;
  v_avg_score numeric(4,2);
  v_percent numeric(5,2);
  v_passed boolean;
  v_pass_min_avg numeric(4,2) := 2.50;
  v_stage_res public.stage_results;
  v_settings jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_booking
  from public.stage4_bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Stage 4 booking % not found', p_booking_id using errcode = 'P0002';
  end if;

  if v_booking.reviewer_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied: caller is not the assigned reviewer for this defence'
      using errcode = '42501';
  end if;

  if v_booking.status = 'completed' then
    raise exception 'Stage 4 defence has already been scored and finalized' using errcode = '23514';
  end if;

  select * into v_app from public.applications where id = v_booking.application_id;

  -- Find corresponding review_assignment
  select * into v_ra
  from public.review_assignments
  where application_id = v_booking.application_id
    and stage = 4
    and part = 's4_defence'
  order by created_at desc
  limit 1;

  -- Load Stage 4 rubric
  select id into v_rubric_id
  from public.rubrics
  where stage = 4 and part = 's4_defence' and active = true
  limit 1;

  if v_rubric_id is null then
    raise exception 'Active Stage 4 rubric not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_scores) <> 'array' then
    raise exception 'p_scores must be a JSON array of 5 criterion scores' using errcode = '22023';
  end if;

  perform set_config('app.allow_review_write', 'true', true);

  -- Process each criterion score
  for v_item in select * from jsonb_array_elements(p_scores) loop
    v_crit_id := (v_item->>'criterion_id')::uuid;
    v_score := (v_item->>'score')::int;
    v_crit_comment := nullif(btrim(coalesce(v_item->>'comment', '')), '');

    if v_score is null or v_score < 1 or v_score > 4 then
      raise exception 'Each rubric criterion score must be an integer between 1 and 4' using errcode = '22023';
    end if;

    select slug into v_crit_slug
    from public.rubric_criteria
    where id = v_crit_id and rubric_id = v_rubric_id;

    if not found then
      raise exception 'Criterion % does not belong to Stage 4 rubric', v_crit_id using errcode = '22023';
    end if;

    if v_crit_slug = 'understanding_own_work' then
      v_understanding_score := v_score;
    end if;

    v_sum_score := v_sum_score + v_score;
    v_count_score := v_count_score + 1;

    if v_ra.id is not null then
      insert into public.review_scores (assignment_id, criterion_id, score, comment)
      values (v_ra.id, v_crit_id, v_score, v_crit_comment)
      on conflict (assignment_id, criterion_id) do update
      set score = excluded.score,
          comment = excluded.comment;
    end if;
  end loop;

  if v_count_score < v_expected_criteria then
    raise exception 'All 5 Stage 4 rubric criteria must be scored (received %)', v_count_score
      using errcode = '22023';
  end if;

  -- Read runtime minimum threshold from settings if available
  select value into v_settings from public.settings where key = 'stage_pass_minimums';
  if v_settings is not null and (v_settings->>'stage_4_avg') is not null then
    v_pass_min_avg := (v_settings->>'stage_4_avg')::numeric;
  end if;

  v_avg_score := round(v_sum_score::numeric / v_count_score::numeric, 2);

  -- Blueprint Section 7.1: Pass = average >= 2.5 AND understanding_own_work > 1
  -- An understanding_own_work score of 1 is an automatic fail signal for borrowed/AI work
  if v_understanding_score = 1 then
    v_passed := false;
  else
    v_passed := (v_avg_score >= v_pass_min_avg);
  end if;

  -- Convert rubric average (1..4) to percent (0..100): ((avg - 1) / 3) * 100
  v_percent := round(greatest(0.0, least(100.0, ((v_avg_score - 1.0) / 3.0) * 100.0)), 2);

  perform set_config('app.allow_stage_result_write', 'true', true);

  -- Record stage 4 result
  insert into public.stage_results (
    application_id,
    stage,
    raw_score,
    percent,
    passed,
    details
  )
  values (
    v_booking.application_id,
    4,
    v_avg_score,
    v_percent,
    v_passed,
    jsonb_build_object(
      'average_score', v_avg_score,
      'understanding_own_work', v_understanding_score,
      'scores', p_scores,
      'comment', p_comment,
      'passed', v_passed,
      'reviewer_id', v_uid
    )
  )
  on conflict (application_id, stage) do update
  set raw_score = excluded.raw_score,
      percent = excluded.percent,
      passed = excluded.passed,
      details = excluded.details
  returning * into v_stage_res;

  -- Mark booking completed
  update public.stage4_bookings
  set status = 'completed',
      completed_at = now(),
      notes = coalesce(p_comment, notes)
  where id = p_booking_id;

  -- Mark review assignment submitted
  if v_ra.id is not null then
    update public.review_assignments
    set status = 'submitted',
        avg_score = v_avg_score,
        submitted_at = now()
    where id = v_ra.id;
  end if;

  -- Advance application status
  perform set_config('app.internal_caller', 'true', true);
  if v_passed then
    perform public.advance_status(
      v_booking.application_id,
      's4_passed',
      format('Stage 4 Live Defence passed (Avg: %s / 4.0, %s%%)', v_avg_score, v_percent)
    );
  else
    perform public.advance_status(
      v_booking.application_id,
      's4_failed',
      format('Stage 4 Live Defence failed (Avg: %s / 4.0, understanding: %s/4)', v_avg_score, coalesce(v_understanding_score, 0))
    );
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'stage4_review_submitted',
    'stage4_bookings',
    p_booking_id,
    null,
    jsonb_build_object(
      'application_id', v_booking.application_id,
      'average_score', v_avg_score,
      'understanding_own_work', v_understanding_score,
      'passed', v_passed,
      'percent', v_percent
    )
  );

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'application_id', v_booking.application_id,
    'average_score', v_avg_score,
    'percent', v_percent,
    'passed', v_passed,
    'understanding_own_work', v_understanding_score
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. compute_overall Function
-- -----------------------------------------------------------------------------

create or replace function public.compute_overall(
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_s1 public.stage_results;
  v_s2 public.stage_results;
  v_s3 public.stage_results;
  v_s4 public.stage_results;
  v_weights jsonb;
  v_minima jsonb;
  v_tiers jsonb;
  v_w1 numeric(5,4) := 0.15;
  v_w2 numeric(5,4) := 0.25;
  v_w3 numeric(5,4) := 0.35;
  v_w4 numeric(5,4) := 0.25;
  v_min1 numeric(5,2) := 60.0;
  v_min2 numeric(5,2) := 60.0;
  v_min3 numeric(5,2) := 60.0;
  v_min4_avg numeric(4,2) := 2.50;
  v_th_cert numeric(5,2) := 70.0;
  v_th_pro numeric(5,2) := 80.0;
  v_th_pro_s3 numeric(5,2) := 75.0;
  v_th_elite numeric(5,2) := 90.0;
  v_th_elite_s4 numeric(4,2) := 3.50;
  v_overall numeric(5,2);
  v_all_minima_met boolean := true;
  v_tier text := null;
  v_details jsonb;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then
    raise exception 'Application % not found', p_application_id using errcode = 'P0002';
  end if;

  -- Load all 4 stage results
  select * into v_s1 from public.stage_results where application_id = p_application_id and stage = 1;
  select * into v_s2 from public.stage_results where application_id = p_application_id and stage = 2;
  select * into v_s3 from public.stage_results where application_id = p_application_id and stage = 3;
  select * into v_s4 from public.stage_results where application_id = p_application_id and stage = 4;

  if v_s1.id is null or v_s2.id is null or v_s3.id is null or v_s4.id is null then
    raise exception 'All 4 stages must be completed before computing overall score' using errcode = '23514';
  end if;

  -- Read runtime configuration from settings table (Rule 9 of AGENTS.md)
  select value into v_weights from public.settings where key = 'stage_weights';
  if v_weights is not null then
    v_w1 := coalesce((v_weights->>'stage_1')::numeric, v_w1);
    v_w2 := coalesce((v_weights->>'stage_2')::numeric, v_w2);
    v_w3 := coalesce((v_weights->>'stage_3')::numeric, v_w3);
    v_w4 := coalesce((v_weights->>'stage_4')::numeric, v_w4);
  end if;

  select value into v_minima from public.settings where key = 'stage_pass_minimums';
  if v_minima is not null then
    v_min1 := coalesce((v_minima->>'stage_1_pct')::numeric, v_min1);
    v_min2 := coalesce((v_minima->>'stage_2_pct')::numeric, v_min2);
    v_min3 := coalesce((v_minima->>'stage_3_pct')::numeric, v_min3);
    v_min4_avg := coalesce((v_minima->>'stage_4_avg')::numeric, v_min4_avg);
  end if;

  select value into v_tiers from public.settings where key = 'tier_thresholds';
  if v_tiers is not null then
    v_th_cert := coalesce((v_tiers->'certified'->>'overall')::numeric, v_th_cert);
    v_th_pro := coalesce((v_tiers->'certified_pro'->>'overall')::numeric, v_th_pro);
    v_th_pro_s3 := coalesce((v_tiers->'certified_pro'->>'stage_3_min')::numeric, v_th_pro_s3);
    v_th_elite := coalesce((v_tiers->'elite'->>'overall')::numeric, v_th_elite);
    v_th_elite_s4 := coalesce((v_tiers->'elite'->>'stage_4_avg_min')::numeric, v_th_elite_s4);
  end if;

  -- Calculate weighted overall score
  v_overall := round(
    (v_w1 * v_s1.percent) +
    (v_w2 * v_s2.percent) +
    (v_w3 * v_s3.percent) +
    (v_w4 * v_s4.percent),
    2
  );

  -- Check stage minimums (must meet EVERY stage minimum)
  if not v_s1.passed or v_s1.percent < v_min1 then
    v_all_minima_met := false;
  end if;
  if not v_s2.passed or v_s2.percent < v_min2 then
    v_all_minima_met := false;
  end if;
  if not v_s3.passed or v_s3.percent < v_min3 then
    v_all_minima_met := false;
  end if;
  if not v_s4.passed or v_s4.raw_score < v_min4_avg then
    v_all_minima_met := false;
  end if;

  -- Determine tier only if all minimums met and overall >= 70
  if v_all_minima_met and v_overall >= v_th_cert then
    if v_overall >= v_th_elite and v_s4.raw_score >= v_th_elite_s4 then
      v_tier := 'elite';
    elsif v_overall >= v_th_pro and v_s3.percent >= v_th_pro_s3 then
      v_tier := 'certified_pro';
    else
      v_tier := 'certified';
    end if;
  end if;

  -- Update application score
  perform set_config('app.allow_score_update', 'true', true);
  update public.applications
  set score = v_overall
  where id = p_application_id;

  v_details := jsonb_build_object(
    'application_id', p_application_id,
    'overall', v_overall,
    'tier', v_tier,
    'all_minima_met', v_all_minima_met,
    'stage_results', jsonb_build_object(
      'stage_1', jsonb_build_object('percent', v_s1.percent, 'passed', v_s1.passed),
      'stage_2', jsonb_build_object('percent', v_s2.percent, 'passed', v_s2.passed),
      'stage_3', jsonb_build_object('percent', v_s3.percent, 'passed', v_s3.passed),
      'stage_4', jsonb_build_object('percent', v_s4.percent, 'raw_score', v_s4.raw_score, 'passed', v_s4.passed)
    ),
    'weights', jsonb_build_object('stage_1', v_w1, 'stage_2', v_w2, 'stage_3', v_w3, 'stage_4', v_w4)
  );

  return v_details;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Admin Credential Issuance Function
-- -----------------------------------------------------------------------------

create or replace function public.admin_issue_credential(
  p_application_id uuid
)
returns public.credentials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_overall_data jsonb;
  v_overall numeric(5,2);
  v_tier text;
  v_minima_met boolean;
  v_validity_months integer := 24;
  v_settings jsonb;
  v_code text;
  v_credential public.credentials;
  v_exists boolean;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied: only admins can issue credentials' using errcode = '42501';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Application % not found', p_application_id using errcode = 'P0002';
  end if;

  -- Compute overall result
  v_overall_data := public.compute_overall(p_application_id);
  v_overall := (v_overall_data->>'overall')::numeric;
  v_tier := v_overall_data->>'tier';
  v_minima_met := (v_overall_data->>'all_minima_met')::boolean;

  if not v_minima_met or v_tier is null then
    raise exception 'Candidate is not eligible for credential (overall: %, tier: %, all_minima_met: %)',
      v_overall, v_tier, v_minima_met
      using errcode = '23514';
  end if;

  select value into v_settings from public.settings where key = 'credential_validity';
  if v_settings is not null and (v_settings->>'months') is not null then
    v_validity_months := (v_settings->>'months')::int;
  end if;

  -- Generate random unguessable verify_code (format: VET-XXXX-XXXX)
  loop
    v_code := 'VET-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
                        upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 5, 4));
    select exists (select 1 from public.credentials where verify_code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  -- Insert credential record
  insert into public.credentials (
    application_id,
    tier,
    overall,
    issued_at,
    expires_at,
    verify_code,
    revoked
  )
  values (
    p_application_id,
    v_tier,
    v_overall,
    now(),
    now() + (v_validity_months || ' months')::interval,
    v_code,
    false
  )
  on conflict (application_id) do update
  set tier = excluded.tier,
      overall = excluded.overall,
      issued_at = now(),
      expires_at = now() + (v_validity_months || ' months')::interval,
      verify_code = v_code,
      revoked = false,
      revoked_at = null,
      revoked_reason = null
  returning * into v_credential;

  -- Advance status to certified
  perform set_config('app.internal_caller', 'true', true);
  perform public.advance_status(
    p_application_id,
    'certified',
    format('Credential issued (%s tier, %s overall)', v_tier, v_overall)
  );

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'credential_issued',
    'credentials',
    v_credential.id,
    null,
    jsonb_build_object(
      'application_id', p_application_id,
      'tier', v_tier,
      'overall', v_overall,
      'verify_code', v_code,
      'expires_at', v_credential.expires_at
    )
  );

  return v_credential;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Admin Credential Revocation Function
-- -----------------------------------------------------------------------------

create or replace function public.admin_revoke_credential(
  p_credential_id uuid,
  p_reason text
)
returns public.credentials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cred public.credentials;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Access denied: only admins can revoke credentials' using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A clear revocation reason is required' using errcode = '22023';
  end if;

  update public.credentials
  set revoked = true,
      revoked_at = now(),
      revoked_reason = p_reason
  where id = p_credential_id
  returning * into v_cred;

  if not found then
    raise exception 'Credential % not found', p_credential_id using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'credential_revoked',
    'credentials',
    p_credential_id,
    null,
    jsonb_build_object(
      'reason', p_reason,
      'revoked_at', v_cred.revoked_at
    )
  );

  return v_cred;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Public Credential Verification Endpoint
-- Strictly leaks zero PII (Rule 3 & Section 5.2)
-- Returns name, track, tier, dates, and validity status only
-- -----------------------------------------------------------------------------

create or replace function public.get_public_credential_verification(
  p_verify_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_status text;
  v_is_valid boolean;
begin
  if p_verify_code is null or btrim(p_verify_code) = '' then
    return jsonb_build_object('found', false, 'error', 'Invalid verification code');
  end if;

  select
    c.id as credential_id,
    c.verify_code,
    c.tier,
    c.issued_at,
    c.expires_at,
    c.revoked,
    a.track,
    p.full_name
  into v_row
  from public.credentials c
  join public.applications a on a.id = c.application_id
  join public.profiles p on p.user_id = a.user_id
  where c.verify_code = btrim(p_verify_code);

  if not found then
    return jsonb_build_object('found', false, 'error', 'Credential not found');
  end if;

  if v_row.revoked then
    v_status := 'revoked';
    v_is_valid := false;
  elsif v_row.expires_at < now() then
    v_status := 'expired';
    v_is_valid := false;
  else
    v_status := 'valid';
    v_is_valid := true;
  end if;

  -- Return ONLY the specified safe fields (Section 5.2 of platform-design.md)
  return jsonb_build_object(
    'found', true,
    'full_name', v_row.full_name,
    'track', v_row.track,
    'tier', v_row.tier,
    'issued_at', v_row.issued_at,
    'expires_at', v_row.expires_at,
    'is_valid', v_is_valid,
    'status', v_status,
    'verify_code', v_row.verify_code
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Employer Scorecard RPC
-- Detailed sanitized breakdown for verified employers
-- -----------------------------------------------------------------------------

create or replace function public.get_employer_scorecard(
  p_verify_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cred public.credentials;
  v_app public.applications;
  v_prof public.profiles;
  v_s1 public.stage_results;
  v_s2 public.stage_results;
  v_s3 public.stage_results;
  v_s4 public.stage_results;
  v_s2_attempt public.exam_attempts;
  v_domain_scores jsonb := '[]'::jsonb;
  v_status text;
  v_is_valid boolean;
  v_comm_score integer;
  v_comm_rating text := 'Clear';
  v_approved_comment text;
begin
  select c.* into v_cred
  from public.credentials c
  where c.verify_code = btrim(p_verify_code);

  if not found then
    return jsonb_build_object('found', false, 'error', 'Credential not found');
  end if;

  select * into v_app from public.applications where id = v_cred.application_id;
  select * into v_prof from public.profiles where user_id = v_app.user_id;

  if v_cred.revoked then
    v_status := 'revoked';
    v_is_valid := false;
  elsif v_cred.expires_at < now() then
    v_status := 'expired';
    v_is_valid := false;
  else
    v_status := 'valid';
    v_is_valid := true;
  end if;

  select * into v_s1 from public.stage_results where application_id = v_app.id and stage = 1;
  select * into v_s2 from public.stage_results where application_id = v_app.id and stage = 2;
  select * into v_s3 from public.stage_results where application_id = v_app.id and stage = 3;
  select * into v_s4 from public.stage_results where application_id = v_app.id and stage = 4;

  -- Stage 2 technical exam domain breakdown
  select * into v_s2_attempt
  from public.exam_attempts
  where application_id = v_app.id and stage = 2 and status = 'submitted'
  order by score desc limit 1;

  if v_s2_attempt.id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'domain', q.domain,
          'correct', count(ea.id) filter (where ea.is_correct = true),
          'total', count(ea.id),
          'percent', round((count(ea.id) filter (where ea.is_correct = true)::numeric / count(ea.id)::numeric) * 100.0, 1)
        )
      ),
      '[]'::jsonb
    )
    into v_domain_scores
    from public.exam_answers ea
    join public.questions q on q.id = ea.question_id
    where ea.attempt_id = v_s2_attempt.id
    group by q.domain;
  end if;

  -- Stage 4 communication rating
  if v_s4.details is not null then
    v_approved_comment := v_s4.details->>'comment';
    for v_comm_score in
      select (el->>'score')::int
      from jsonb_array_elements(v_s4.details->'scores') el
      where el->>'criterion_id' in (
        select rc.id::text from public.rubric_criteria rc where rc.slug = 'communication'
      )
    loop
      v_comm_rating := case v_comm_score
        when 1 then 'Developing'
        when 2 then 'Functional'
        when 3 then 'Clear and Structured'
        when 4 then 'Exemplary'
        else 'Clear'
      end;
    end loop;
  end if;

  return jsonb_build_object(
    'found', true,
    'full_name', v_prof.full_name,
    'track', v_app.track,
    'tier', v_cred.tier,
    'overall', v_cred.overall,
    'issued_at', v_cred.issued_at,
    'expires_at', v_cred.expires_at,
    'status', v_status,
    'is_valid', v_is_valid,
    'verify_code', v_cred.verify_code,
    'stage_percentages', jsonb_build_object(
      'stage_1_foundation', coalesce(v_s1.percent, 0),
      'stage_2_exam', coalesce(v_s2.percent, 0),
      'stage_3_project', coalesce(v_s3.percent, 0),
      'stage_4_defence', coalesce(v_s4.percent, 0)
    ),
    'exam_domain_scores', v_domain_scores,
    'project_summary', jsonb_build_object(
      'total_project_score', coalesce(v_s3.percent, 0),
      'part_a_points', coalesce(v_s3.details->>'part_a_points', '0'),
      'part_b_points', coalesce(v_s3.details->>'part_b_points', '0')
    ),
    'communication_rating', v_comm_rating,
    'reviewer_comment', v_approved_comment
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Permissions
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role, anon;
