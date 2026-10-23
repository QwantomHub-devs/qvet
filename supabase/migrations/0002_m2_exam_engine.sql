-- =============================================================================
-- Milestone 2 (M2): Exam Engine
-- Tables: questions, question_keys, exam_blueprints, exam_attempts,
--         exam_answers, stage_results, integrity_events
-- Includes: RLS policies (deny by default; question_keys locked from candidates),
--           start_exam, get_question, submit_answer, finish_exam,
--           log_integrity_event, admin_import_questions, admin_unlock_stage2_for_testing
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- 1.1 questions
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('ai', 'iot', 'robotics')),
  stage integer not null default 2 check (stage in (1, 2)),
  domain text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  type text not null check (type in ('mcq', 'numeric', 'code_reading')),
  stem text not null,
  code_snippet text,
  options jsonb,
  tolerance numeric(10,4) not null default 0 check (tolerance >= 0),
  active boolean not null default true,
  times_used integer not null default 0 check (times_used >= 0),
  times_correct integer not null default 0 check (times_correct >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_questions_draw on public.questions(track, stage, domain, difficulty, active);

create trigger trg_questions_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

alter table public.questions enable row level security;
alter table public.questions force row level security;

-- 1.2 question_keys (Separate locked table - never readable by candidates or reviewers)
create table public.question_keys (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  correct text not null,
  explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_question_keys_updated_at
before update on public.question_keys
for each row execute function public.set_updated_at();

alter table public.question_keys enable row level security;
alter table public.question_keys force row level security;

-- 1.3 exam_blueprints
create table public.exam_blueprints (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('ai', 'iot', 'robotics')),
  stage integer not null default 2 check (stage in (1, 2)),
  domain text not null,
  count integer not null check (count > 0),
  easy_pct integer not null default 40 check (easy_pct >= 0 and easy_pct <= 100),
  medium_pct integer not null default 40 check (medium_pct >= 0 and medium_pct <= 100),
  hard_pct integer not null default 20 check (hard_pct >= 0 and hard_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track, stage, domain),
  check (easy_pct + medium_pct + hard_pct = 100)
);

create trigger trg_exam_blueprints_updated_at
before update on public.exam_blueprints
for each row execute function public.set_updated_at();

alter table public.exam_blueprints enable row level security;
alter table public.exam_blueprints force row level security;

-- 1.4 exam_attempts
create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  stage integer not null default 2 check (stage in (1, 2)),
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  finished_at timestamptz,
  question_ids uuid[] not null,
  current_index integer not null default 0 check (current_index >= 0),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  domain_scores jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'submitted', 'timed_out', 'reset_by_admin')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_exam_attempts_application on public.exam_attempts(application_id, stage);

create trigger trg_exam_attempts_updated_at
before update on public.exam_attempts
for each row execute function public.set_updated_at();

alter table public.exam_attempts enable row level security;
alter table public.exam_attempts force row level security;

-- 1.5 exam_answers
create table public.exam_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_index integer not null check (question_index >= 0),
  answer text not null,
  answered_at timestamptz not null default now(),
  locked boolean not null default true,
  is_correct boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id),
  unique (attempt_id, question_index)
);

create index idx_exam_answers_attempt on public.exam_answers(attempt_id);

create trigger trg_exam_answers_updated_at
before update on public.exam_answers
for each row execute function public.set_updated_at();

alter table public.exam_answers enable row level security;
alter table public.exam_answers force row level security;

-- 1.6 stage_results
create table public.stage_results (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  stage integer not null check (stage between 1 and 4),
  raw_score numeric(6,2) not null,
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  passed boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, stage)
);

create index idx_stage_results_application on public.stage_results(application_id);

create trigger trg_stage_results_updated_at
before update on public.stage_results
for each row execute function public.set_updated_at();

alter table public.stage_results enable row level security;
alter table public.stage_results force row level security;

-- 1.7 integrity_events
create table public.integrity_events (
  id uuid primary key default gen_random_uuid(),
  attempt_ref uuid not null,
  application_id uuid not null references public.applications(id) on delete cascade,
  type text not null check (type in ('tab_hidden', 'fullscreen_exit', 'flagged_similarity', 'late_paste')),
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_integrity_events_attempt on public.integrity_events(attempt_ref);

create trigger trg_integrity_events_updated_at
before update on public.integrity_events
for each row execute function public.set_updated_at();

alter table public.integrity_events enable row level security;
alter table public.integrity_events force row level security;

-- -----------------------------------------------------------------------------
-- 2. Defense-in-Depth Triggers (Answer Locking & Server-Only Mutation)
-- -----------------------------------------------------------------------------

-- 2.1 Prevent direct client mutations on exam_attempts
create or replace function public.protect_exam_attempts()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_exam_attempt_write', true), '') <> 'true' then
    raise exception 'Exam attempts can only be created or modified by server exam functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_exam_attempts
before insert or update on public.exam_attempts
for each row execute function public.protect_exam_attempts();

-- 2.2 Enforce answer locking: once an answer row is inserted, its answer text cannot be changed
create or replace function public.protect_exam_answers()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.allow_exam_answer_write', true), '') <> 'true' then
      raise exception 'Answers must be submitted through submit_answer()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.locked = true and new.answer is distinct from old.answer then
      raise exception 'Submitted exam answers are locked and cannot be modified'
        using errcode = '42501';
    end if;
    if coalesce(current_setting('app.allow_exam_answer_score', true), '') <> 'true' then
      raise exception 'Exam answer grading can only be updated by finish_exam()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Submitted exam answers cannot be deleted'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_protect_exam_answers
before insert or update or delete on public.exam_answers
for each row execute function public.protect_exam_answers();

-- 2.3 Prevent direct client writes to stage_results
create or replace function public.protect_stage_results()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_stage_result_write', true), '') <> 'true' then
    raise exception 'Stage results can only be written by server scoring functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_protect_stage_results
before insert or update or delete on public.stage_results
for each row execute function public.protect_stage_results();

-- -----------------------------------------------------------------------------
-- 3. Row Level Security Policies (Section 5.2 of platform-design.md)
-- -----------------------------------------------------------------------------

-- 3.1 questions: Admin-only direct table access (candidates only receive active question via get_question RPC)
create policy questions_admin_all
  on public.questions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3.2 question_keys: Strictly locked! Only Admin can read or write; candidates and reviewers have zero policies
create policy question_keys_admin_all
  on public.question_keys for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3.3 exam_blueprints: Authenticated users can read; only Admin can write
create policy exam_blueprints_select_authenticated
  on public.exam_blueprints for select
  to authenticated
  using (true);

create policy exam_blueprints_admin_write
  on public.exam_blueprints for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3.4 exam_attempts: Candidate can read own attempt; Admin can read all; no direct client writes
create policy exam_attempts_select_own_or_admin
  on public.exam_attempts for select
  to authenticated
  using (
    (
      public.current_user_role() = 'candidate'
      and exists (
        select 1 from public.applications a
        where a.id = exam_attempts.application_id
          and a.user_id = auth.uid()
      )
    )
    or public.is_admin()
  );

-- 3.5 exam_answers: Only Admin can read raw exam_answers directly (prevents candidates from reading is_correct)
create policy exam_answers_admin_select
  on public.exam_answers for select
  to authenticated
  using (public.is_admin());

-- 3.6 stage_results: Candidate can read own stage results; Admin can read all
create policy stage_results_select_own_or_admin
  on public.stage_results for select
  to authenticated
  using (
    (
      public.current_user_role() = 'candidate'
      and exists (
        select 1 from public.applications a
        where a.id = stage_results.application_id
          and a.user_id = auth.uid()
      )
    )
    or public.is_admin()
  );

-- 3.7 integrity_events: Admin can read all
create policy integrity_events_admin_select
  on public.integrity_events for select
  to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. Exam Engine Functions (Section 5.3 of platform-design.md)
-- -----------------------------------------------------------------------------

-- 4.1 Helper: Safe numeric parser for grading numeric questions with tolerance
create or replace function public.try_parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_clean text;
begin
  v_clean := btrim(coalesce(p_value, ''));
  if v_clean = '' then
    return null;
  end if;
  return v_clean::numeric;
exception
  when others then
    return null;
end;
$$;

-- 4.2 finish_exam: Scores all drawn questions against question_keys, writes stage_results, advances status
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

  -- Verify authorization: must be the candidate who owns the attempt, or admin/service_role/internal caller
  if coalesce(current_setting('app.internal_caller', true), '') <> 'true'
     and v_app.user_id is distinct from v_uid
     and not public.is_admin_or_service_role() then
    raise exception 'Access denied to exam attempt %', p_attempt_id using errcode = '42501';
  end if;

  -- Idempotency: if already finished, return existing stage_results row
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

  -- Score each question in the drawn list
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

    -- Update question item statistics
    update public.questions
    set times_used = times_used + 1,
        times_correct = times_correct + (case when v_is_correct then 1 else 0 end)
    where id = v_qid;

    if v_is_correct then
      v_correct_count := v_correct_count + 1;
    end if;
  end loop;

  -- Compute per-domain percentages
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

  -- Read pass threshold from runtime settings
  if v_attempt.stage = 2 then
    select coalesce((value->>'stage_2_pct')::numeric, 60.0)
    into v_pass_min
    from public.settings
    where key = 'stage_pass_minimums';
  else
    select coalesce((value->>'stage_1_pct')::numeric, 60.0)
    into v_pass_min
    from public.settings
    where key = 'stage_pass_minimums';
  end if;
  v_pass_min := coalesce(v_pass_min, 60.0);
  v_passed := v_percent >= v_pass_min;

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

  -- Upsert stage_results for Stage 2
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
    v_attempt.stage,
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

  -- Advance application status for Stage 2 exam
  if v_attempt.stage = 2 and v_app.status = 's2_open' then
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

-- 4.3 start_exam: Checks s2_open, draws questions matching blueprint domain & difficulty, sets 60-min server deadline
create or replace function public.start_exam(
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

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found or (v_app.user_id <> v_uid and not public.is_admin_or_service_role()) then
    raise exception 'Application not found or access denied' using errcode = '42501';
  end if;

  -- Check if there is an active in_progress attempt to resume
  select * into v_existing
  from public.exam_attempts
  where application_id = p_application_id
    and stage = 2
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
        'status', 'timed_out',
        'remaining_seconds', 0,
        'current_index', v_existing.current_index,
        'total_questions', coalesce(array_length(v_existing.question_ids, 1), 0),
        'stage_result', to_jsonb(v_stage_res)
      );
    end if;

    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'status', v_existing.status,
      'started_at', v_existing.started_at,
      'deadline_at', v_existing.deadline_at,
      'remaining_seconds', greatest(0, floor(extract(epoch from (v_existing.deadline_at - now())))::int),
      'current_index', v_existing.current_index,
      'total_questions', coalesce(array_length(v_existing.question_ids, 1), 0),
      'resumed', true
    );
  end if;

  -- Starting a new Stage 2 exam requires application status = 's2_open'
  if v_app.status <> 's2_open' then
    raise exception 'Stage 2 exam can only be started when application status is s2_open (current: %)', v_app.status
      using errcode = '23514';
  end if;

  -- Read timer duration from runtime settings
  select coalesce((value->>'stage_2_minutes')::int, 60)
  into v_exam_minutes
  from public.settings
  where key = 'timers';
  v_exam_minutes := coalesce(v_exam_minutes, 60);

  -- Build temporary domain allocation table to match both per-domain counts and overall 40/40/20 difficulty mix
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
    and eb.stage = 2
  order by eb.domain;

  select
    coalesce(sum(eb.count), 0)::int,
    round(coalesce(sum(eb.count * eb.easy_pct / 100.0), 0))::int,
    round(coalesce(sum(eb.count * eb.hard_pct / 100.0), 0))::int
  into v_total_count, v_target_easy, v_target_hard
  from public.exam_blueprints eb
  where eb.track = v_app.track
    and eb.stage = 2;

  if v_total_count = 0 then
    raise exception 'No exam blueprint configured for track %', v_app.track using errcode = 'P0002';
  end if;

  v_target_medium := v_total_count - v_target_easy - v_target_hard;

  select sum(easy_cnt), sum(medium_cnt), sum(hard_cnt)
  into v_sum_easy, v_sum_medium, v_sum_hard
  from tmp_blueprint_alloc;

  -- Distribute fractional remainder seats across domains (at most +1 per difficulty per domain)
  -- 1. Hard remainder seats ordered by largest fractional remainder (eb.count * eb.hard_pct) % 100
  for v_rec in
    select a.domain
    from tmp_blueprint_alloc a
    join public.exam_blueprints eb
      on eb.track = v_app.track and eb.stage = 2 and eb.domain = a.domain
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

  -- 2. Easy remainder seats ordered by largest fractional remainder (eb.count * eb.easy_pct) % 100
  for v_rec in
    select a.domain
    from tmp_blueprint_alloc a
    join public.exam_blueprints eb
      on eb.track = v_app.track and eb.stage = 2 and eb.domain = a.domain
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

  -- 3. Remaining remainder seats go to medium_cnt
  update tmp_blueprint_alloc
  set medium_cnt = medium_cnt + rem_cnt,
      rem_cnt = 0
  where rem_cnt > 0;

  -- Draw random active questions per domain and difficulty
  for v_rec in select * from tmp_blueprint_alloc order by domain loop
    -- Easy draw for domain
    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = 2 and q.domain = v_rec.domain
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

    -- Medium draw for domain
    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = 2 and q.domain = v_rec.domain
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

    -- Hard draw for domain
    select array_agg(id) into v_drawn_domain
    from (
      select q.id
      from public.questions q
      where q.track = v_app.track and q.stage = 2 and q.domain = v_rec.domain
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

  -- Shuffle the combined question list so domains/difficulties are interleaved randomly
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
    2,
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
      'stage', 2,
      'total_questions', array_length(v_shuffled, 1),
      'deadline_at', v_attempt.deadline_at
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
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

-- 4.4 get_question: Serves ONLY the current unanswered question (stem + options), enforces deadline & no backtracking
create or replace function public.get_question(
  p_attempt_id uuid,
  p_index integer default null
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
  v_target_index integer;
  v_qid uuid;
  v_q public.questions;
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

  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied to exam attempt' using errcode = '42501';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'Exam attempt is no longer in progress (status: %)', v_attempt.status
      using errcode = '23514';
  end if;

  -- Server-enforced deadline: auto-submit immediately if deadline has passed
  if now() >= v_attempt.deadline_at then
    perform set_config('app.internal_caller', 'true', true);
    perform public.finish_exam(p_attempt_id);
    raise exception 'Exam deadline has passed; attempt has been auto-submitted'
      using errcode = '23514';
  end if;

  v_total := coalesce(array_length(v_attempt.question_ids, 1), 0);
  v_target_index := v_attempt.current_index;

  -- Enforce one-question-at-a-time & no going back / no skipping ahead
  if p_index is not null and p_index <> v_target_index then
    raise exception 'Navigation to question index % is forbidden; current unanswered index is %',
      p_index, v_target_index
      using errcode = '23514';
  end if;

  if v_target_index >= v_total then
    perform set_config('app.internal_caller', 'true', true);
    perform public.finish_exam(p_attempt_id);
    raise exception 'All questions have been answered; exam is finished'
      using errcode = '23514';
  end if;

  -- PostgreSQL arrays are 1-indexed
  v_qid := v_attempt.question_ids[v_target_index + 1];

  select * into v_q
  from public.questions
  where id = v_qid;

  -- Return ONLY safe fields (stem, code_snippet, options, type, domain, timer). Never question_keys!
  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'question_index', v_target_index,
    'total_questions', v_total,
    'question_id', v_q.id,
    'domain', v_q.domain,
    'type', v_q.type,
    'stem', v_q.stem,
    'code_snippet', v_q.code_snippet,
    'options', v_q.options,
    'deadline_at', v_attempt.deadline_at,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int)
  );
end;
$$;

-- 4.5 submit_answer: Locks answer for the current question, advances index, auto-submits on deadline or final item
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
    btrim(p_answer),
    now(),
    true
  );

  v_new_index := v_attempt.current_index + 1;

  perform set_config('app.allow_exam_attempt_write', 'true', true);

  update public.exam_attempts
  set current_index = v_new_index
  where id = p_attempt_id;

  -- If this was the final question, automatically finish and score the exam
  if v_new_index >= v_total then
    perform set_config('app.internal_caller', 'true', true);
    v_stage_res := public.finish_exam(p_attempt_id);
    return jsonb_build_object(
      'attempt_id', p_attempt_id,
      'locked', true,
      'finished', true,
      'current_index', v_new_index,
      'total_questions', v_total,
      'stage_result', to_jsonb(v_stage_res)
    );
  end if;

  return jsonb_build_object(
    'attempt_id', p_attempt_id,
    'locked', true,
    'finished', false,
    'current_index', v_new_index,
    'total_questions', v_total,
    'remaining_seconds', greatest(0, floor(extract(epoch from (v_attempt.deadline_at - now())))::int)
  );
end;
$$;

-- 4.6 log_integrity_event: Browser focus / fullscreen telemetry (flags only, never auto-fails)
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

-- 4.7 admin_import_questions: Bulk question + locked key import (used by Admin CSV import)
create or replace function public.admin_import_questions(
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_qid uuid;
  v_count integer := 0;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Only administrators can import questions' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.questions (
      track,
      stage,
      domain,
      difficulty,
      type,
      stem,
      code_snippet,
      options,
      tolerance,
      active
    )
    values (
      lower(btrim(v_item->>'track')),
      coalesce((v_item->>'stage')::int, 2),
      btrim(v_item->>'domain'),
      lower(btrim(v_item->>'difficulty')),
      lower(btrim(v_item->>'type')),
      btrim(v_item->>'stem'),
      nullif(btrim(coalesce(v_item->>'code_snippet', '')), ''),
      case
        when v_item ? 'options' and jsonb_typeof(v_item->'options') = 'array' then v_item->'options'
        else null
      end,
      coalesce((v_item->>'tolerance')::numeric, 0),
      coalesce((v_item->>'active')::boolean, true)
    )
    returning id into v_qid;

    insert into public.question_keys (
      question_id,
      correct,
      explanation
    )
    values (
      v_qid,
      btrim(v_item->>'correct'),
      nullif(btrim(coalesce(v_item->>'explanation', '')), '')
    );

    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'questions_imported',
    'questions',
    null,
    null,
    jsonb_build_object('imported_count', v_count)
  );

  return v_count;
end;
$$;

-- 4.8 admin_unlock_stage2: Moves an approved application through s1_open -> s1_passed -> s2_open via advance_status
create or replace function public.admin_unlock_stage2(
  p_application_id uuid
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
begin
  if not public.is_admin_or_service_role() then
    raise exception 'Only administrators can unlock Stage 2' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'Application % not found', p_application_id using errcode = 'P0002';
  end if;

  perform set_config('app.internal_caller', 'true', true);

  if v_app.status = 'approved' then
    v_app := public.advance_status(p_application_id, 's1_open', 'Admin unlocked Stage 1');
  end if;

  if v_app.status = 's1_open' then
    v_app := public.advance_status(p_application_id, 's1_passed', 'Admin marked Stage 1 passed to open Stage 2');
  end if;

  if v_app.status = 's1_passed' then
    v_app := public.advance_status(p_application_id, 's2_open', 'Stage 2 Technical Exam unlocked');
  end if;

  return v_app;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Explicit Role Grants (RLS enforces row and operation access)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
