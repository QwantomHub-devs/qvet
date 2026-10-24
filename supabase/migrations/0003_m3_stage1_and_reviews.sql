-- =============================================================================
-- Milestone 3 (M3): Stage 1 Foundation Screen & Blind Review Engine
-- Tables: prompts, responses, rubrics, rubric_criteria, review_assignments, review_scores
-- Includes:
--   - RLS policies (deny by default, blind review, peer score isolation)
--   - Private storage bucket (stage1-videos)
--   - Stage 1 Part A (text + 10s autosave), Part B (2-min low-res video), Part C (15 logic items)
--   - Blind reviewer assignment (no same-institution, 2 reviewers, auto 3rd reviewer if |r1 - r2| > 1)
--   - Stage 1 weighted aggregation (40% Part A + 30% Part B + 30% Part C)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- 1.1 prompts: Rotating written and video prompts for Stage 1
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('ai', 'iot', 'robotics')),
  stage integer not null default 1 check (stage = 1),
  kind text not null check (kind in ('text', 'video')),
  title text not null,
  prompt_text text not null,
  target_words integer default 150,
  max_duration_seconds integer default 120,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_prompts_lookup on public.prompts(track, stage, kind) where active = true;

create trigger trg_prompts_updated_at
before update on public.prompts
for each row execute function public.set_updated_at();

alter table public.prompts enable row level security;
alter table public.prompts force row level security;

-- 1.2 responses: Candidate Stage 1 written (Part A) and video (Part B) responses
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete restrict,
  kind text not null check (kind in ('text', 'video')),
  text text,
  word_count integer not null default 0 check (word_count >= 0),
  storage_path text,
  file_size_bytes bigint check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 26214400)),
  mime_type text check (mime_type is null or mime_type in ('video/webm', 'video/mp4', 'video/quicktime')),
  duration_seconds numeric(6,2) check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 125)),
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  last_saved_at timestamptz not null default now(),
  submitted_at timestamptz,
  locked boolean not null default false,
  final_rubric_avg numeric(4,2) check (final_rubric_avg is null or (final_rubric_avg >= 1 and final_rubric_avg <= 4)),
  final_percent numeric(5,2) check (final_percent is null or (final_percent >= 0 and final_percent <= 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, kind)
);

create index idx_responses_application on public.responses(application_id);

create trigger trg_responses_updated_at
before update on public.responses
for each row execute function public.set_updated_at();

alter table public.responses enable row level security;
alter table public.responses force row level security;

-- 1.3 rubrics: Editable rubrics per stage, track, and part
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  stage integer not null check (stage between 1 and 4),
  track text not null check (track in ('ai', 'iot', 'robotics', 'all')),
  part text not null check (part in ('s1_text', 's1_video', 's3_project', 's4_defence')),
  title text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage, track, part)
);

create trigger trg_rubrics_updated_at
before update on public.rubrics
for each row execute function public.set_updated_at();

alter table public.rubrics enable row level security;
alter table public.rubrics force row level security;

-- 1.4 rubric_criteria: Criteria and 1-to-4 anchor descriptions for each rubric
create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  slug text not null,
  criterion text not null,
  weight numeric(5,2) not null default 1.0 check (weight > 0),
  scale_min integer not null default 1,
  scale_max integer not null default 4,
  anchors jsonb not null default '{}'::jsonb,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rubric_id, slug),
  check (scale_min < scale_max)
);

create index idx_rubric_criteria_rubric on public.rubric_criteria(rubric_id, sort_order);

create trigger trg_rubric_criteria_updated_at
before update on public.rubric_criteria
for each row execute function public.set_updated_at();

alter table public.rubric_criteria enable row level security;
alter table public.rubric_criteria force row level security;

-- 1.5 review_assignments: Blind reviewer assignments (double scoring + automatic 3rd tie-breaker)
create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  response_id uuid references public.responses(id) on delete cascade,
  stage integer not null default 1 check (stage between 1 and 4),
  part text not null check (part in ('s1_text', 's1_video', 's3_project', 's4_defence')),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  review_round integer not null default 1 check (review_round between 1 and 3),
  is_second_review boolean not null default false,
  is_third_review boolean not null default false,
  status text not null default 'assigned' check (status in ('assigned', 'submitted', 'cancelled')),
  avg_score numeric(4,2) check (avg_score is null or (avg_score >= 1 and avg_score <= 4)),
  due_at timestamptz not null default (now() + interval '48 hours'),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (response_id, reviewer_id)
);

create index idx_review_assignments_reviewer on public.review_assignments(reviewer_id, status);
create index idx_review_assignments_response on public.review_assignments(response_id);

create trigger trg_review_assignments_updated_at
before update on public.review_assignments
for each row execute function public.set_updated_at();

alter table public.review_assignments enable row level security;
alter table public.review_assignments force row level security;

-- 1.6 review_scores: Per-criterion scores (1..4) and optional reviewer comments
create table public.review_scores (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria(id) on delete restrict,
  score integer not null check (score between 1 and 4),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, criterion_id)
);

create index idx_review_scores_assignment on public.review_scores(assignment_id);

create trigger trg_review_scores_updated_at
before update on public.review_scores
for each row execute function public.set_updated_at();

alter table public.review_scores enable row level security;
alter table public.review_scores force row level security;

-- -----------------------------------------------------------------------------
-- 2. Defense-in-Depth Triggers & Blind Review Helper Functions
-- -----------------------------------------------------------------------------

-- 2.1 Protect responses from direct client mutation
create or replace function public.protect_responses()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_response_write', true), '') <> 'true' then
    raise exception 'Stage 1 responses can only be modified through server functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_responses
before insert or update or delete on public.responses
for each row execute function public.protect_responses();

-- 2.2 Enforce institution separation & server-only writes on review_assignments
create or replace function public.protect_review_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer_role text;
  v_reviewer_inst uuid;
  v_candidate_inst uuid;
begin
  if coalesce(current_setting('app.allow_review_write', true), '') <> 'true'
     and not public.is_admin_or_service_role() then
    raise exception 'Review assignments can only be created or modified by server functions'
      using errcode = '42501';
  end if;

  select p.role, p.institution_id
  into v_reviewer_role, v_reviewer_inst
  from public.profiles p
  where p.user_id = new.reviewer_id;

  if v_reviewer_role is distinct from 'reviewer' then
    raise exception 'Assigned user % does not have reviewer role', new.reviewer_id
      using errcode = '23514';
  end if;

  select p.institution_id
  into v_candidate_inst
  from public.applications a
  join public.profiles p on p.user_id = a.user_id
  where a.id = new.application_id;

  -- Non-negotiable Rule 10: A reviewer cannot be assigned work from their own institution
  if v_reviewer_inst is not null
     and v_candidate_inst is not null
     and v_reviewer_inst = v_candidate_inst then
    raise exception 'Conflict of interest: reviewer cannot be assigned work from their own institution (%).', v_reviewer_inst
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_protect_review_assignments
before insert or update on public.review_assignments
for each row execute function public.protect_review_assignments();

-- 2.3 Protect review_scores from direct client mutation
create or replace function public.protect_review_scores()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_review_write', true), '') <> 'true' then
    raise exception 'Review scores must be submitted via submit_review()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_review_scores
before insert or update or delete on public.review_scores
for each row execute function public.protect_review_scores();

-- 2.4 Security-definer helpers for RLS on responses, review_assignments & review_scores
create or replace function public.is_reviewer_assigned_to_response(
  p_response_id uuid,
  p_reviewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.review_assignments ra
    where ra.response_id = p_response_id
      and ra.reviewer_id = p_reviewer_id
      and ra.status in ('assigned', 'submitted')
  );
$$;

create or replace function public.has_reviewer_submitted_for_response(
  p_response_id uuid,
  p_reviewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.review_assignments ra
    where ra.response_id = p_response_id
      and ra.reviewer_id = p_reviewer_id
      and ra.status = 'submitted'
  );
$$;

create or replace function public.can_reviewer_read_assignment_scores(
  p_assignment_id uuid,
  p_reviewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.review_assignments target_ra
    where target_ra.id = p_assignment_id
      and (
        -- Reviewer can always read their own submitted/saved scores
        target_ra.reviewer_id = p_reviewer_id
        or (
          -- Reviewer can read another reviewer's scores ONLY AFTER submitting their own review for the same item
          target_ra.response_id is not null
          and public.has_reviewer_submitted_for_response(target_ra.response_id, p_reviewer_id)
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------

-- 3.1 prompts: Authenticated users can read active prompts; Admin can manage all
create policy prompts_select_authenticated
  on public.prompts for select
  to authenticated
  using (active = true or public.is_admin());

create policy prompts_admin_all
  on public.prompts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3.2 responses:
--   - Candidate can read their own responses
--   - Reviewer can read responses assigned to them (responses table has no name or institution)
--   - Admin can read all
create policy responses_select_policy
  on public.responses for select
  to authenticated
  using (
    (
      public.current_user_role() = 'candidate'
      and exists (
        select 1 from public.applications a
        where a.id = responses.application_id
          and a.user_id = auth.uid()
      )
    )
    or (
      public.current_user_role() = 'reviewer'
      and public.is_reviewer_assigned_to_response(responses.id, auth.uid())
    )
    or public.is_admin()
  );

-- 3.3 rubrics & rubric_criteria: Readable by authenticated users; writable by admins
create policy rubrics_select_authenticated
  on public.rubrics for select
  to authenticated
  using (active = true or public.is_admin());

create policy rubrics_admin_all
  on public.rubrics for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy rubric_criteria_select_authenticated
  on public.rubric_criteria for select
  to authenticated
  using (true);

create policy rubric_criteria_admin_all
  on public.rubric_criteria for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3.4 review_assignments:
--   - Candidates can NEVER read review_assignments
--   - Reviewers can read their own assignments, or peer assignments on the same response AFTER submitting their own
--   - Admins can read all
create policy review_assignments_select_policy
  on public.review_assignments for select
  to authenticated
  using (
    (
      public.current_user_role() = 'reviewer'
      and (
        reviewer_id = auth.uid()
        or (
          response_id is not null
          and public.has_reviewer_submitted_for_response(response_id, auth.uid())
        )
      )
    )
    or public.is_admin()
  );

-- 3.5 review_scores:
--   - Candidates can NEVER read review_scores (Rule 3: reviewer comments/scores hidden from candidates)
--   - Reviewers can read their own scores, or peer scores on the same item ONLY AFTER submitting their own review
--   - Admins can read all
create policy review_scores_select_policy
  on public.review_scores for select
  to authenticated
  using (
    (
      public.current_user_role() = 'reviewer'
      and public.can_reviewer_read_assignment_scores(assignment_id, auth.uid())
    )
    or public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- 4. Private Storage Bucket for Stage 1 Video Responses (stage1-videos)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stage1-videos',
  'stage1-videos',
  false,
  26214400, -- 25 MB cap
  array['video/webm', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array['video/webm', 'video/mp4', 'video/quicktime'];

create policy storage_stage1_videos_candidate_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'stage1-videos'
    and public.current_user_role() = 'candidate'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy storage_stage1_videos_candidate_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'stage1-videos'
    and public.current_user_role() = 'candidate'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'stage1-videos'
    and public.current_user_role() = 'candidate'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 5. Stage 1 & Blind Review Functions (Sections 5.4 and 5.7 of platform-design.md)
-- -----------------------------------------------------------------------------

-- 5.1 Helper: Count words in plain text
create or replace function public.count_words(p_text text)
returns integer
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_text, '')) = '' then 0
    else coalesce(array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1), 0)
  end;
$$;

-- 5.2 assign_reviewers_for_response: Assigns N blind reviewers who do NOT share the candidate's institution
create or replace function public.assign_reviewers_for_response(
  p_response_id uuid,
  p_count integer default 2,
  p_is_third_review boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp public.responses;
  v_app public.applications;
  v_cand_inst uuid;
  v_part text;
  v_existing_count integer := 0;
  v_assigned_now integer := 0;
  v_rev record;
  v_round integer;
begin
  select * into v_resp from public.responses where id = p_response_id for update;
  if not found then
    raise exception 'Response % not found', p_response_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_resp.application_id;
  select p.institution_id into v_cand_inst from public.profiles p where p.user_id = v_app.user_id;

  v_part := case when v_resp.kind = 'text' then 's1_text' else 's1_video' end;

  select count(*)::int into v_existing_count
  from public.review_assignments
  where response_id = p_response_id
    and status <> 'cancelled';

  perform set_config('app.allow_review_write', 'true', true);

  for v_rev in
    select
      p.user_id as reviewer_id,
      count(ra.id) filter (where ra.status = 'assigned')::int as open_load
    from public.profiles p
    left join public.review_assignments ra on ra.reviewer_id = p.user_id
    where p.role = 'reviewer'
      -- Non-negotiable Rule 10: Never assign a reviewer from the candidate's institution
      and (
        v_cand_inst is null
        or p.institution_id is null
        or p.institution_id <> v_cand_inst
      )
      -- Do not assign the same reviewer twice to the same response
      and not exists (
        select 1 from public.review_assignments existing_ra
        where existing_ra.response_id = p_response_id
          and existing_ra.reviewer_id = p.user_id
      )
    group by p.user_id
    order by open_load asc, random()
    limit p_count
  loop
    v_existing_count := v_existing_count + 1;
    v_round := case when p_is_third_review then 3 else least(v_existing_count, 2) end;

    insert into public.review_assignments (
      application_id,
      response_id,
      stage,
      part,
      reviewer_id,
      review_round,
      is_second_review,
      is_third_review,
      status,
      due_at
    )
    values (
      v_app.id,
      p_response_id,
      1,
      v_part,
      v_rev.reviewer_id,
      v_round,
      (v_round = 2),
      p_is_third_review or (v_round = 3),
      'assigned',
      now() + interval '48 hours'
    );

    v_assigned_now := v_assigned_now + 1;
  end loop;

  if v_assigned_now < p_count then
    raise exception 'Insufficient eligible non-conflicting reviewers available (needed %, found %)',
      p_count, v_assigned_now
      using errcode = 'P0002';
  end if;

  return v_assigned_now;
end;
$$;

-- 5.3 compute_stage1_result: Aggregates Part A (40%) + Part B (30%) + Part C (30%) when all 3 are complete
create or replace function public.compute_stage1_result(
  p_application_id uuid
)
returns public.stage_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_text_resp public.responses;
  v_video_resp public.responses;
  v_logic_attempt public.exam_attempts;
  v_weight_a numeric(5,4) := 0.40;
  v_weight_b numeric(5,4) := 0.30;
  v_weight_c numeric(5,4) := 0.30;
  v_pass_min numeric(5,2) := 60.0;
  v_overall_pct numeric(5,2);
  v_passed boolean;
  v_stage_result public.stage_results;
begin
  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    return null;
  end if;

  select * into v_text_resp
  from public.responses
  where application_id = p_application_id and kind = 'text';

  select * into v_video_resp
  from public.responses
  where application_id = p_application_id and kind = 'video';

  select * into v_logic_attempt
  from public.exam_attempts
  where application_id = p_application_id
    and stage = 1
    and status in ('submitted', 'timed_out')
  order by created_at desc
  limit 1;

  -- Wait until Part A, Part B, and Part C are all finalized
  if v_text_resp.id is null or v_text_resp.final_percent is null then
    return null;
  end if;

  if v_video_resp.id is null or v_video_resp.final_percent is null then
    return null;
  end if;

  if v_logic_attempt.id is null or v_logic_attempt.score is null then
    return null;
  end if;

  -- Load Stage 1 sub-weights from settings if configured
  select
    coalesce((value->>'part_a')::numeric, 0.40),
    coalesce((value->>'part_b')::numeric, 0.30),
    coalesce((value->>'part_c')::numeric, 0.30)
  into v_weight_a, v_weight_b, v_weight_c
  from public.settings
  where key = 'stage_1_weights';

  v_weight_a := coalesce(v_weight_a, 0.40);
  v_weight_b := coalesce(v_weight_b, 0.30);
  v_weight_c := coalesce(v_weight_c, 0.30);

  select coalesce((value->>'stage_1_pct')::numeric, 60.0)
  into v_pass_min
  from public.settings
  where key = 'stage_pass_minimums';
  v_pass_min := coalesce(v_pass_min, 60.0);

  v_overall_pct := round(
    (v_weight_a * v_text_resp.final_percent) +
    (v_weight_b * v_video_resp.final_percent) +
    (v_weight_c * v_logic_attempt.score),
    2
  );

  v_passed := v_overall_pct >= v_pass_min;

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
    p_application_id,
    1,
    v_overall_pct,
    v_overall_pct,
    v_passed,
    jsonb_build_object(
      'part_a_rubric_avg', v_text_resp.final_rubric_avg,
      'part_a_percent', v_text_resp.final_percent,
      'part_b_rubric_avg', v_video_resp.final_rubric_avg,
      'part_b_percent', v_video_resp.final_percent,
      'part_c_percent', v_logic_attempt.score,
      'weights', jsonb_build_object('part_a', v_weight_a, 'part_b', v_weight_b, 'part_c', v_weight_c)
    )
  )
  on conflict (application_id, stage) do update
  set raw_score = excluded.raw_score,
      percent = excluded.percent,
      passed = excluded.passed,
      details = excluded.details
  returning * into v_stage_result;

  perform set_config('app.internal_caller', 'true', true);

  if v_app.status = 'approved' then
    perform public.advance_status(p_application_id, 's1_open', 'Stage 1 opened automatically for finalization');
    v_app.status := 's1_open';
  end if;

  if v_app.status = 's1_open' then
    if v_passed then
      perform public.advance_status(
        p_application_id,
        's1_passed',
        format('Stage 1 Foundation Screen passed (%s%%)', v_overall_pct)
      );
      -- Automatically unlock Stage 2 Technical Exam
      perform public.advance_status(
        p_application_id,
        's2_open',
        'Stage 2 Technical Exam unlocked after passing Stage 1'
      );
    else
      perform public.advance_status(
        p_application_id,
        's1_failed',
        format('Stage 1 Foundation Screen below minimum (%s%% < %s%%)', v_overall_pct, v_pass_min)
      );
    end if;
  end if;

  return v_stage_result;
end;
$$;

-- 5.4 start_stage1: Opens Stage 1 (approved -> s1_open) and returns current Stage 1 overview
create or replace function public.start_stage1(
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
  v_text_resp public.responses;
  v_video_resp public.responses;
  v_logic_attempt public.exam_attempts;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found or (v_app.user_id <> v_uid and not public.is_admin_or_service_role()) then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  if v_app.status = 'approved' then
    perform set_config('app.internal_caller', 'true', true);
    v_app := public.advance_status(
      p_application_id,
      's1_open',
      'Candidate started Stage 1 Foundation Screen'
    );
  end if;

  select * into v_text_resp from public.responses where application_id = p_application_id and kind = 'text';
  select * into v_video_resp from public.responses where application_id = p_application_id and kind = 'video';
  select * into v_logic_attempt
  from public.exam_attempts
  where application_id = p_application_id and stage = 1
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'application_id', v_app.id,
    'status', v_app.status,
    'text_response', to_jsonb(v_text_resp),
    'video_response', to_jsonb(v_video_resp),
    'logic_attempt', case
      when v_logic_attempt.id is null then null
      else jsonb_build_object(
        'id', v_logic_attempt.id,
        'status', v_logic_attempt.status,
        'current_index', v_logic_attempt.current_index,
        'total_questions', coalesce(array_length(v_logic_attempt.question_ids, 1), 0),
        'deadline_at', v_logic_attempt.deadline_at,
        'remaining_seconds', greatest(0, floor(extract(epoch from (v_logic_attempt.deadline_at - now())))::int),
        'score', v_logic_attempt.score
      )
    end
  );
end;
$$;

-- 5.5 start_stage1_part: Assigns a rotating prompt for Part A ('text') or Part B ('video') and sets server deadline
create or replace function public.start_stage1_part(
  p_application_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.applications;
  v_existing public.responses;
  v_prompt public.prompts;
  v_minutes integer;
  v_resp public.responses;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_kind not in ('text', 'video') then
    raise exception 'Invalid Stage 1 response kind %', p_kind using errcode = '22023';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found or (v_app.user_id <> v_uid and not public.is_admin_or_service_role()) then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  if v_app.status = 'approved' then
    perform set_config('app.internal_caller', 'true', true);
    v_app := public.advance_status(p_application_id, 's1_open', 'Candidate started Stage 1');
  end if;

  select * into v_existing
  from public.responses
  where application_id = p_application_id and kind = p_kind
  for update;

  if found then
    select * into v_prompt from public.prompts where id = v_existing.prompt_id;

    -- Auto-lock text response if deadline has passed while unlocked
    if not v_existing.locked and now() >= v_existing.deadline_at then
      perform set_config('app.allow_response_write', 'true', true);
      update public.responses
      set locked = true,
          submitted_at = coalesce(submitted_at, now())
      where id = v_existing.id
      returning * into v_existing;

      if v_existing.kind = 'text' and coalesce(btrim(v_existing.text), '') <> '' then
        perform public.assign_reviewers_for_response(v_existing.id, 2, false);
      end if;
    end if;

    return jsonb_build_object(
      'response', to_jsonb(v_existing),
      'prompt', to_jsonb(v_prompt),
      'remaining_seconds', greatest(0, floor(extract(epoch from (v_existing.deadline_at - now())))::int)
    );
  end if;

  if v_app.status <> 's1_open' then
    raise exception 'Stage 1 can only be started when application status is approved or s1_open (current: %)', v_app.status
      using errcode = '23514';
  end if;

  -- Draw an active rotating prompt at random for the candidate's track and kind
  select * into v_prompt
  from public.prompts p
  where p.track = v_app.track
    and p.stage = 1
    and p.kind = p_kind
    and p.active = true
  order by random()
  limit 1;

  if not found then
    raise exception 'No active Stage 1 % prompt configured for track %', p_kind, v_app.track
      using errcode = 'P0002';
  end if;

  if p_kind = 'text' then
    select coalesce((value->>'stage_1_part_a_minutes')::int, 15)
    into v_minutes
    from public.settings
    where key = 'timers';
    v_minutes := coalesce(v_minutes, 15);
  else
    select coalesce((value->>'stage_1_part_b_minutes')::int, 10)
    into v_minutes
    from public.settings
    where key = 'timers';
    v_minutes := coalesce(v_minutes, 10);
  end if;

  perform set_config('app.allow_response_write', 'true', true);

  insert into public.responses (
    application_id,
    prompt_id,
    kind,
    text,
    word_count,
    started_at,
    deadline_at,
    last_saved_at,
    locked
  )
  values (
    p_application_id,
    v_prompt.id,
    p_kind,
    case when p_kind = 'text' then '' else null end,
    0,
    now(),
    now() + make_interval(mins => v_minutes),
    now(),
    false
  )
  returning * into v_resp;

  return jsonb_build_object(
    'response', to_jsonb(v_resp),
    'prompt', to_jsonb(v_prompt),
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_resp.deadline_at - now())))::int)
  );
end;
$$;

-- 5.6 save_text_response: Autosaves Part A text every 10s; locks automatically if deadline has passed
create or replace function public.save_text_response(
  p_application_id uuid,
  p_text text
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
  v_words integer;
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
  where application_id = p_application_id and kind = 'text'
  for update;

  if not found then
    raise exception 'Part A written response has not been started yet' using errcode = 'P0002';
  end if;

  if v_resp.locked then
    raise exception 'Written response is already locked and submitted' using errcode = '23514';
  end if;

  perform set_config('app.allow_response_write', 'true', true);

  -- Enforce server deadline: if deadline has passed, lock what was previously saved and assign reviewers
  if now() > v_resp.deadline_at then
    update public.responses
    set locked = true,
        submitted_at = coalesce(submitted_at, now())
    where id = v_resp.id
    returning * into v_resp;

    if coalesce(btrim(v_resp.text), '') <> '' then
      perform public.assign_reviewers_for_response(v_resp.id, 2, false);
    end if;

    raise exception 'Part A deadline has passed; written explanation is now locked'
      using errcode = '23514';
  end if;

  v_words := public.count_words(p_text);

  update public.responses
  set text = coalesce(p_text, ''),
      word_count = v_words,
      last_saved_at = now()
  where id = v_resp.id
  returning * into v_resp;

  return jsonb_build_object(
    'response', to_jsonb(v_resp),
    'word_count', v_words,
    'last_saved_at', v_resp.last_saved_at,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_resp.deadline_at - now())))::int)
  );
end;
$$;

-- 5.7 submit_text_response: Finalizes and locks Part A written explanation and assigns 2 blind reviewers
create or replace function public.submit_text_response(
  p_application_id uuid,
  p_text text
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
  v_final_text text;
  v_words integer;
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
  where application_id = p_application_id and kind = 'text'
  for update;

  if not found then
    raise exception 'Part A written response has not been started yet' using errcode = 'P0002';
  end if;

  if v_resp.locked then
    raise exception 'Written response is already locked' using errcode = '23514';
  end if;

  -- If submitted before deadline, use p_text; if after deadline, lock the last autosaved text
  if now() <= v_resp.deadline_at then
    v_final_text := coalesce(p_text, v_resp.text, '');
  else
    v_final_text := coalesce(v_resp.text, '');
  end if;

  v_words := public.count_words(v_final_text);
  if v_words < 5 then
    raise exception 'Please provide a complete written explanation (at least 5 words) before submitting.'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_response_write', 'true', true);

  update public.responses
  set text = v_final_text,
      word_count = v_words,
      last_saved_at = now(),
      submitted_at = now(),
      locked = true
  where id = v_resp.id
  returning * into v_resp;

  v_assigned := public.assign_reviewers_for_response(v_resp.id, 2, false);

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'stage1_text_submitted',
    'responses',
    v_resp.id,
    null,
    jsonb_build_object('word_count', v_words, 'reviewers_assigned', v_assigned)
  );

  return jsonb_build_object(
    'response', to_jsonb(v_resp),
    'reviewers_assigned', v_assigned
  );
end;
$$;

-- 5.8 submit_video_response: Validates 2-min / 25 MB cap, locks Part B video response, and assigns 2 blind reviewers
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

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > v_max_bytes then
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
      file_size_bytes = p_file_size_bytes,
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
      'file_size_bytes', p_file_size_bytes,
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

-- 5.9 Blind Review View & Queue RPC: Strips candidate name, email, phone, GitHub, and institution
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
        'response_kind', r.kind,
        'response_text', r.text,
        'word_count', r.word_count,
        'storage_path', r.storage_path,
        'mime_type', r.mime_type,
        'duration_seconds', r.duration_seconds,
        'response_submitted_at', r.submitted_at,
        'prompt_title', p.title,
        'prompt_text', p.prompt_text,
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
        -- Peer reviews are NULL/empty until THIS reviewer has submitted their own review
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
  where (v_role = 'admin' or ra.reviewer_id = v_uid)
    and ra.status <> 'cancelled';

  return v_result;
end;
$$;

-- 5.10 submit_review: Saves criterion scores (1..4), enforces double-scoring agreement, triggers 3rd review if |r1 - r2| > 1
create or replace function public.submit_review(
  p_assignment_id uuid,
  p_scores jsonb -- array of {"criterion_id": uuid, "score": int, "comment": text}
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
        -- Section 5.7 & AI Blueprint Section 4: Differ by > 1 point -> automatically assign 3rd reviewer
        perform public.assign_reviewers_for_response(v_ra.response_id, 1, true);
        v_third_review_triggered := true;
      else
        v_final_avg := round((v_submitted_scores[1] + v_submitted_scores[2]) / 2.0, 2);
      end if;
    elsif v_submitted_count >= 3 then
      -- 3 reviews submitted: resolve using the two closest scores (or median if equidistant)
      if abs(v_submitted_scores[3] - v_submitted_scores[1]) < abs(v_submitted_scores[3] - v_submitted_scores[2]) then
        v_final_avg := round((v_submitted_scores[3] + v_submitted_scores[1]) / 2.0, 2);
      elsif abs(v_submitted_scores[3] - v_submitted_scores[2]) < abs(v_submitted_scores[3] - v_submitted_scores[1]) then
        v_final_avg := round((v_submitted_scores[3] + v_submitted_scores[2]) / 2.0, 2);
      else
        -- Equidistant (e.g. 1.0, 4.0, and 2.5): mean/median is the 3rd reviewer's score
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

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'review_submitted',
    'review_assignments',
    v_ra.id,
    null,
    jsonb_build_object(
      'response_id', v_ra.response_id,
      'review_round', v_ra.review_round,
      'avg_score', v_my_avg,
      'third_review_triggered', v_third_review_triggered,
      'final_rubric_avg', v_final_avg
    )
  );

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

-- -----------------------------------------------------------------------------
-- 6. Extend Exam Engine Functions (start_exam & finish_exam) to Support Stage 1 Part C (stage = 1)
-- -----------------------------------------------------------------------------

create or replace function public.finish_exam(
  p_attempt_id uuid
)
returns public.stage_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.exam_attempts;
  v_app public.applications;
  v_total_questions integer;
  v_correct_count integer := 0;
  v_percent numeric(5,2);
  v_pass_min numeric(5,2) := 60.0;
  v_passed boolean;
  v_final_status text;
  v_domain_scores jsonb := '{}'::jsonb;
  v_stage_result public.stage_results;
  v_idx integer;
  v_qid uuid;
  v_q public.questions;
  v_key public.question_keys;
  v_ans public.exam_answers;
  v_is_correct boolean;
  v_cand_num numeric;
  v_key_num numeric;
begin
  select * into v_attempt
  from public.exam_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Exam attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app
  from public.applications
  where id = v_attempt.application_id
  for update;

  if coalesce(current_setting('app.internal_caller', true), '') <> 'true'
     and v_app.user_id is distinct from v_uid
     and not public.is_admin_or_service_role() then
    raise exception 'Access denied to exam attempt %', p_attempt_id using errcode = '42501';
  end if;

  if v_attempt.status in ('submitted', 'timed_out') then
    select * into v_stage_result
    from public.stage_results
    where application_id = v_app.id
      and stage = v_attempt.stage;
    return v_stage_result;
  end if;

  v_total_questions := coalesce(array_length(v_attempt.question_ids, 1), 0);
  if v_total_questions = 0 then
    raise exception 'Exam attempt has no drawn questions' using errcode = '22023';
  end if;

  perform set_config('app.allow_exam_answer_score', 'true', true);

  for v_idx in 1..v_total_questions loop
    v_qid := v_attempt.question_ids[v_idx];

    select * into v_q from public.questions where id = v_qid;
    select * into v_key from public.question_keys where question_id = v_qid;
    select * into v_ans
    from public.exam_answers
    where attempt_id = v_attempt.id
      and question_id = v_qid;

    v_is_correct := false;

    if v_ans.id is not null and v_key.id is not null then
      if v_q.type = 'numeric' then
        v_cand_num := public.try_parse_numeric(v_ans.answer);
        v_key_num := public.try_parse_numeric(v_key.correct);
        if v_cand_num is not null and v_key_num is not null then
          v_is_correct := abs(v_cand_num - v_key_num) <= coalesce(v_q.tolerance, 0);
        end if;
      else
        v_is_correct := lower(btrim(v_ans.answer)) = lower(btrim(v_key.correct));
      end if;

      update public.exam_answers
      set is_correct = v_is_correct
      where id = v_ans.id;
    end if;

    update public.questions
    set times_used = times_used + 1,
        times_correct = times_correct + (case when v_is_correct then 1 else 0 end)
    where id = v_qid;

    if v_is_correct then
      v_correct_count := v_correct_count + 1;
    end if;
  end loop;

  select coalesce(
    jsonb_object_agg(
      domain_stats.domain,
      jsonb_build_object(
        'correct', domain_stats.correct_cnt,
        'total', domain_stats.total_cnt,
        'percent', round((domain_stats.correct_cnt::numeric / domain_stats.total_cnt::numeric) * 100.0, 2)
      )
    ),
    '{}'::jsonb
  )
  into v_domain_scores
  from (
    select
      q.domain,
      count(*)::int as total_cnt,
      count(*) filter (where coalesce(ea.is_correct, false) = true)::int as correct_cnt
    from unnest(v_attempt.question_ids) with ordinality as drawn(qid, ord)
    join public.questions q on q.id = drawn.qid
    left join public.exam_answers ea
      on ea.attempt_id = v_attempt.id and ea.question_id = drawn.qid
    group by q.domain
  ) as domain_stats;

  v_percent := round((v_correct_count::numeric / v_total_questions::numeric) * 100.0, 2);

  v_final_status := case
    when now() > v_attempt.deadline_at and v_attempt.current_index < v_total_questions then 'timed_out'
    else 'submitted'
  end;

  perform set_config('app.allow_exam_attempt_write', 'true', true);

  update public.exam_attempts
  set status = v_final_status,
      finished_at = now(),
      score = v_percent,
      domain_scores = v_domain_scores
  where id = v_attempt.id;

  -- Stage 1 Part C: Trigger compute_stage1_result (which combines Part A + Part B + Part C)
  if v_attempt.stage = 1 then
    v_stage_result := public.compute_stage1_result(v_app.id);

    insert into public.audit_log (actor, action, entity, entity_id, before, after)
    values (
      v_uid,
      'stage1_logic_exam_finished',
      'exam_attempts',
      v_attempt.id,
      jsonb_build_object('status', 'in_progress'),
      jsonb_build_object(
        'status', v_final_status,
        'raw_score', v_correct_count,
        'percent', v_percent
      )
    );

    return v_stage_result;
  end if;

  -- Stage 2 Technical Exam: Write stage_results directly and advance s2_open -> s2_passed / s2_failed
  select coalesce((value->>'stage_2_pct')::numeric, 60.0)
  into v_pass_min
  from public.settings
  where key = 'stage_pass_minimums';
  v_pass_min := coalesce(v_pass_min, 60.0);
  v_passed := v_percent >= v_pass_min;

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
    2,
    v_correct_count,
    v_percent,
    v_passed,
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'total_questions', v_total_questions,
      'correct_count', v_correct_count,
      'attempt_status', v_final_status,
      'domain_scores', v_domain_scores
    )
  )
  on conflict (application_id, stage) do update
  set raw_score = excluded.raw_score,
      percent = excluded.percent,
      passed = excluded.passed,
      details = excluded.details
  returning * into v_stage_result;

  if v_app.status = 's2_open' then
    perform set_config('app.internal_caller', 'true', true);
    perform public.advance_status(
      v_app.id,
      case when v_passed then 's2_passed' else 's2_failed' end,
      format('Stage 2 Technical Exam finished (%s/%s = %s%%)', v_correct_count, v_total_questions, v_percent)
    );
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'exam_finished',
    'exam_attempts',
    v_attempt.id,
    jsonb_build_object('status', 'in_progress'),
    jsonb_build_object(
      'status', v_final_status,
      'raw_score', v_correct_count,
      'percent', v_percent,
      'passed', v_passed
    )
  );

  return v_stage_result;
end;
$$;

-- Replace 1-arg start_exam with p_stage default 2 so both Stage 2 (40 items, 60 min) and Stage 1 Part C (15 items, 20 min) share the engine
drop function if exists public.start_exam(uuid);

create or replace function public.start_exam(
  p_application_id uuid,
  p_stage integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.applications;
  v_existing public.exam_attempts;
  v_exam_minutes integer := 60;
  v_total_count integer := 0;
  v_target_easy integer := 0;
  v_target_hard integer := 0;
  v_target_medium integer := 0;
  v_sum_easy integer := 0;
  v_sum_medium integer := 0;
  v_sum_hard integer := 0;
  v_rec record;
  v_drawn_domain uuid[];
  v_all_drawn uuid[] := array[]::uuid[];
  v_shuffled uuid[];
  v_attempt public.exam_attempts;
  v_stage_res public.stage_results;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_stage not in (1, 2) then
    raise exception 'Invalid exam stage % (must be 1 or 2)', p_stage using errcode = '22023';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found or (v_app.user_id <> v_uid and not public.is_admin_or_service_role()) then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  -- Check if there is an active in_progress attempt to resume for this stage
  select * into v_existing
  from public.exam_attempts
  where application_id = p_application_id
    and stage = p_stage
    and status = 'in_progress'
  order by created_at desc
  limit 1
  for update;

  if found then
    if now() >= v_existing.deadline_at then
      perform set_config('app.internal_caller', 'true', true);
      v_stage_res := public.finish_exam(v_existing.id);
      return jsonb_build_object(
        'attempt_id', v_existing.id,
        'stage', p_stage,
        'status', 'timed_out',
        'remaining_seconds', 0,
        'current_index', v_existing.current_index,
        'total_questions', coalesce(array_length(v_existing.question_ids, 1), 0),
        'stage_result', to_jsonb(v_stage_res)
      );
    end if;

    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'stage', p_stage,
      'status', v_existing.status,
      'started_at', v_existing.started_at,
      'deadline_at', v_existing.deadline_at,
      'remaining_seconds', greatest(0, floor(extract(epoch from (v_existing.deadline_at - now())))::int),
      'current_index', v_existing.current_index,
      'total_questions', coalesce(array_length(v_existing.question_ids, 1), 0),
      'resumed', true
    );
  end if;

  -- Validate application status for starting a new exam attempt
  if p_stage = 2 then
    if v_app.status <> 's2_open' then
      raise exception 'Stage 2 exam can only be started when application status is s2_open (current: %)', v_app.status
        using errcode = '23514';
    end if;
    select coalesce((value->>'stage_2_minutes')::int, 60)
    into v_exam_minutes
    from public.settings
    where key = 'timers';
    v_exam_minutes := coalesce(v_exam_minutes, 60);
  else
    -- Stage 1 Part C Logic Exam
    if v_app.status = 'approved' then
      perform set_config('app.internal_caller', 'true', true);
      v_app := public.advance_status(p_application_id, 's1_open', 'Candidate started Stage 1 Part C Logic Exam');
    end if;
    if v_app.status <> 's1_open' then
      raise exception 'Stage 1 Part C exam can only be started when application status is approved or s1_open (current: %)', v_app.status
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.exam_attempts
      where application_id = p_application_id and stage = 1 and status in ('submitted', 'timed_out')
    ) then
      raise exception 'Stage 1 Part C logic exam has already been completed' using errcode = '23514';
    end if;
    select coalesce((value->>'stage_1_part_c_minutes')::int, 20)
    into v_exam_minutes
    from public.settings
    where key = 'timers';
    v_exam_minutes := coalesce(v_exam_minutes, 20);
  end if;

  create temp table if not exists tmp_blueprint_alloc (
    domain text primary key,
    total_cnt int,
    easy_cnt int,
    medium_cnt int,
    hard_cnt int,
    rem_cnt int
  ) on commit drop;
  truncate table tmp_blueprint_alloc;

  insert into tmp_blueprint_alloc (domain, total_cnt, easy_cnt, medium_cnt, hard_cnt, rem_cnt)
  select
    eb.domain,
    eb.count,
    floor(eb.count * eb.easy_pct / 100.0)::int,
    floor(eb.count * eb.medium_pct / 100.0)::int,
    floor(eb.count * eb.hard_pct / 100.0)::int,
    eb.count - (
      floor(eb.count * eb.easy_pct / 100.0)::int +
      floor(eb.count * eb.medium_pct / 100.0)::int +
      floor(eb.count * eb.hard_pct / 100.0)::int
    )
  from public.exam_blueprints eb
  where eb.track = v_app.track
    and eb.stage = p_stage
  order by eb.domain;

  select
    coalesce(sum(eb.count), 0)::int,
    round(coalesce(sum(eb.count * eb.easy_pct / 100.0), 0))::int,
    round(coalesce(sum(eb.count * eb.hard_pct / 100.0), 0))::int
  into v_total_count, v_target_easy, v_target_hard
  from public.exam_blueprints eb
  where eb.track = v_app.track
    and eb.stage = p_stage;

  if v_total_count = 0 then
    raise exception 'No exam blueprint configured for track % stage %', v_app.track, p_stage using errcode = 'P0002';
  end if;

  v_target_medium := v_total_count - v_target_easy - v_target_hard;

  select sum(easy_cnt), sum(medium_cnt), sum(hard_cnt)
  into v_sum_easy, v_sum_medium, v_sum_hard
  from tmp_blueprint_alloc;

  for v_rec in
    select a.domain
    from tmp_blueprint_alloc a
    join public.exam_blueprints eb
      on eb.track = v_app.track and eb.stage = p_stage and eb.domain = a.domain
    where a.rem_cnt > 0
    order by ((eb.count * eb.hard_pct) % 100) desc, a.domain asc
  loop
    exit when v_sum_hard >= v_target_hard;
    update tmp_blueprint_alloc
    set hard_cnt = hard_cnt + 1,
        rem_cnt = rem_cnt - 1
    where domain = v_rec.domain;
    v_sum_hard := v_sum_hard + 1;
  end loop;

  for v_rec in
    select a.domain
    from tmp_blueprint_alloc a
    join public.exam_blueprints eb
      on eb.track = v_app.track and eb.stage = p_stage and eb.domain = a.domain
    where a.rem_cnt > 0
    order by ((eb.count * eb.easy_pct) % 100) desc, a.domain asc
  loop
    exit when v_sum_easy >= v_target_easy;
    update tmp_blueprint_alloc
    set easy_cnt = easy_cnt + 1,
        rem_cnt = rem_cnt - 1
    where domain = v_rec.domain;
    v_sum_easy := v_sum_easy + 1;
  end loop;

  update tmp_blueprint_alloc
  set medium_cnt = medium_cnt + rem_cnt,
      rem_cnt = 0
  where rem_cnt > 0;

  for v_rec in select * from tmp_blueprint_alloc order by domain loop
    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = p_stage and q.domain = v_rec.domain
        and q.difficulty = 'easy' and q.active = true
      order by random()
      limit v_rec.easy_cnt
    ) s;
    if coalesce(array_length(v_drawn_domain, 1), 0) < v_rec.easy_cnt then
      raise exception 'Insufficient active easy questions in domain % (need %, found %)',
        v_rec.domain, v_rec.easy_cnt, coalesce(array_length(v_drawn_domain, 1), 0)
        using errcode = 'P0002';
    end if;
    v_all_drawn := v_all_drawn || coalesce(v_drawn_domain, array[]::uuid[]);

    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = p_stage and q.domain = v_rec.domain
        and q.difficulty = 'medium' and q.active = true
      order by random()
      limit v_rec.medium_cnt
    ) s;
    if coalesce(array_length(v_drawn_domain, 1), 0) < v_rec.medium_cnt then
      raise exception 'Insufficient active medium questions in domain % (need %, found %)',
        v_rec.domain, v_rec.medium_cnt, coalesce(array_length(v_drawn_domain, 1), 0)
        using errcode = 'P0002';
    end if;
    v_all_drawn := v_all_drawn || coalesce(v_drawn_domain, array[]::uuid[]);

    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = p_stage and q.domain = v_rec.domain
        and q.difficulty = 'hard' and q.active = true
      order by random()
      limit v_rec.hard_cnt
    ) s;
    if coalesce(array_length(v_drawn_domain, 1), 0) < v_rec.hard_cnt then
      raise exception 'Insufficient active hard questions in domain % (need %, found %)',
        v_rec.domain, v_rec.hard_cnt, coalesce(array_length(v_drawn_domain, 1), 0)
        using errcode = 'P0002';
    end if;
    v_all_drawn := v_all_drawn || coalesce(v_drawn_domain, array[]::uuid[]);
  end loop;

  select array_agg(qid order by random())
  into v_shuffled
  from unnest(v_all_drawn) as qid;

  perform set_config('app.allow_exam_attempt_write', 'true', true);

  insert into public.exam_attempts (
    application_id,
    stage,
    started_at,
    deadline_at,
    question_ids,
    current_index,
    status
  )
  values (
    p_application_id,
    p_stage,
    now(),
    now() + make_interval(mins => v_exam_minutes),
    v_shuffled,
    0,
    'in_progress'
  )
  returning * into v_attempt;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'exam_started',
    'exam_attempts',
    v_attempt.id,
    null,
    jsonb_build_object(
      'application_id', p_application_id,
      'stage', p_stage,
      'total_questions', array_length(v_shuffled, 1),
      'deadline_at', v_attempt.deadline_at
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'stage', p_stage,
    'status', v_attempt.status,
    'started_at', v_attempt.started_at,
    'deadline_at', v_attempt.deadline_at,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int),
    'current_index', v_attempt.current_index,
    'total_questions', array_length(v_shuffled, 1),
    'resumed', false
  );
end;
$$;

-- 6.2 Admin RPC to update rubric criteria & anchors at runtime
create or replace function public.admin_update_rubric_criterion(
  p_criterion_id uuid,
  p_criterion text,
  p_anchors jsonb
)
returns public.rubric_criteria
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_updated public.rubric_criteria;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Only administrators can edit rubric criteria' using errcode = '42501';
  end if;

  select to_jsonb(rc.*) into v_before from public.rubric_criteria rc where rc.id = p_criterion_id;
  if not found then
    raise exception 'Rubric criterion % not found', p_criterion_id using errcode = 'P0002';
  end if;

  update public.rubric_criteria
  set criterion = coalesce(nullif(btrim(p_criterion), ''), criterion),
      anchors = coalesce(p_anchors, anchors)
  where id = p_criterion_id
  returning * into v_updated;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'rubric_criterion_updated',
    'rubric_criteria',
    p_criterion_id,
    v_before,
    to_jsonb(v_updated)
  );

  return v_updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Explicit Role Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

