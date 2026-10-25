-- =============================================================================
-- Migration 0009: Milestone 7 (M7) - IoT Track
-- Per AGENTS.md & docs/blueprint-iot.md:
-- 1. Table constraints update:
--    - grading_jobs: allow device_sim, iot_firmware, iot_cloud, robot_sim, robotics_control, robotics_perception
--    - project_component_scores: allow component 'E'
-- 2. Practical project RPCs update:
--    - request_practice_run: support track-specific job kinds (device_sim for IoT)
--    - finalize_project: support track-specific job kinds
--    - save_job_result / record_grader_result: IoT component max points mapping (A1: 20, A2: 15, A3: 10, B1: 10, B2: 10, C: 15, D: 10, E: 10)
--    - compute_stage3_result: IoT pass requirements (60 total, >= 18 Part A, >= 8 Part B)
-- 3. Stage 1 IoT Foundation Screen:
--    - Blueprints (logic_patterns 5, probability_numeracy 5, charts_data 5)
--    - Rotating prompts (4 written, 4 video)
--    - 15 clearly marked fake sample logic & numeracy questions + keys
-- 4. Stage 2 IoT Technical Exam:
--    - Blueprints (40 questions across 6 domains: electronics_hardware 6, embedded_programming 8, buses_wireless 8, iot_cloud_architecture 6, security_reliability 6, power_debugging_deployment 6)
--    - 48 fake sample questions (8 per domain: 3 easy, 3 medium, 2 hard) with MCQ, code reading, and numeric calculations + keys
-- 5. Stage 3 IoT Scenario & Rubrics:
--    - Scenario: Cold-Chain Vaccine Transport Monitor
--    - Rubric: Stage 3 IoT Project (C: 15, D: 10, E: 10)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table Constraints Update
-- -----------------------------------------------------------------------------

alter table public.grading_jobs drop constraint if exists grading_jobs_kind_check;
alter table public.grading_jobs add constraint grading_jobs_kind_check
  check (kind in (
    'predictions', 'retrieval', 'static_checks',
    'device_sim', 'iot_firmware', 'iot_cloud',
    'robot_sim', 'robotics_control', 'robotics_perception'
  ));

alter table public.project_component_scores drop constraint if exists project_component_scores_component_check;
alter table public.project_component_scores add constraint project_component_scores_component_check
  check (component in ('A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C', 'D', 'E'));

-- -----------------------------------------------------------------------------
-- 2. Practical Project RPCs Update
-- -----------------------------------------------------------------------------

-- 2.1 request_practice_run
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

  -- Determine track-specific grading job kind
  v_job_kind := case
    when v_app.track = 'ai' then
      case when p_part = 'A' then 'predictions' else 'retrieval' end
    when v_app.track = 'iot' then
      case when p_part = 'A' then 'device_sim' else 'iot_cloud' end
    when v_app.track = 'robotics' then
      case when p_part = 'A' then 'robot_sim' else 'robotics_perception' end
    else
      case when p_part = 'A' then 'predictions' else 'retrieval' end
  end;

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
    nullif(btrim(p_client_request_id), '')
  )
  returning * into v_job;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    v_uid,
    'practice_run_requested',
    'grading_jobs',
    v_job.id,
    null,
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'submission_id', v_sub.id,
      'part', p_part,
      'kind', v_job_kind,
      'runs_used', v_attempt.runs_used,
      'client_request_id', p_client_request_id
    )
  );

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

-- 2.2 finalize_project
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
  v_sub public.submissions;
  v_final_count integer := 0;
  v_part text;
  v_job_kind text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.project_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Project attempt % not found', p_attempt_id using errcode = 'P0002';
  end if;

  select * into v_app from public.applications where id = v_attempt.application_id;
  if v_app.user_id <> v_uid and not public.is_admin_or_service_role() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if v_attempt.status in ('submitted', 'graded', 'timed_out') then
    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'already_finalized', true
    );
  end if;

  perform set_config('app.allow_submission_write', 'true', true);

  -- For each part (A, B, C, writeup), mark the most recent submission as final
  foreach v_part in array array['A', 'B', 'C', 'writeup'] loop
    select * into v_sub
    from public.submissions
    where attempt_id = v_attempt.id and part = v_part
    order by submitted_at desc
    limit 1;

    if v_sub.id is not null then
      update public.submissions set is_final = true where id = v_sub.id;
      v_final_count := v_final_count + 1;

      -- Queue automatic final grading job if Part A or Part B
      if v_part in ('A', 'B') then
        v_job_kind := case
          when v_app.track = 'ai' then
            case when v_part = 'A' then 'predictions' else 'retrieval' end
          when v_app.track = 'iot' then
            case when v_part = 'A' then 'device_sim' else 'iot_cloud' end
          when v_app.track = 'robotics' then
            case when v_part = 'A' then 'robot_sim' else 'robotics_perception' end
          else
            case when v_part = 'A' then 'predictions' else 'retrieval' end
        end;

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

-- 2.3 save_job_result
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
  v_app public.applications;
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
  select * into v_app from public.applications where id = v_attempt.application_id;

  perform set_config('app.allow_grading_job_write', 'true', true);

  update public.grading_jobs
  set status = p_status,
      finished_at = now(),
      result = coalesce(p_result, '{}'::jsonb),
      candidate_feedback = p_candidate_feedback,
      error = p_error
  where id = v_job.id
  returning * into v_job;

  -- If this was a final job, save component points
  if v_job.mode = 'final' and p_status = 'done' and p_component_points is not null then
    for v_comp, v_pts in select key, value::text::numeric from jsonb_each_text(p_component_points) loop
      v_max := case
        when v_comp = 'A1' and v_app.track = 'ai' then 15.0
        when v_comp = 'A1' and v_app.track in ('iot', 'robotics') then 20.0
        when v_comp = 'A2' and v_app.track in ('iot', 'robotics') then 15.0
        when v_comp = 'A3' and v_app.track in ('iot', 'robotics') then 10.0
        when v_comp = 'B1' and v_app.track = 'ai' then 15.0
        when v_comp = 'B1' and v_app.track in ('iot', 'robotics') then 10.0
        when v_comp = 'B2' and v_app.track in ('iot', 'robotics') then 10.0
        when v_comp = 'B3' then 10.0
        when v_comp = 'C' then 15.0
        when v_comp in ('D', 'E') then 10.0
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

-- 2.4 compute_stage3_result
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
begin
  select * into v_attempt from public.project_attempts where id = p_attempt_id for update;
  if not found then return null; end if;

  select * into v_app from public.applications where id = v_attempt.application_id;

  -- Check if all 8 components exist
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

  -- Blueprint 6.3: Pass mark 60 points, with at least 40% in each of Part A and Part B
  if v_app.track = 'ai' then
    v_passed := (v_total_points >= 60.0) and (v_part_a >= 16.0) and (v_part_b >= 16.0);
  else
    -- IoT & Robotics: Part A max 45 (40% = 18.0), Part B max 20 (40% = 8.0)
    v_passed := (v_total_points >= 60.0) and (v_part_a >= 18.0) and (v_part_b >= 8.0);
  end if;

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
      format('Stage 3 practical project passed (%s pts, Part A: %s, Part B: %s)', v_total_points, v_part_a, v_part_b)
    );
  else
    perform public.advance_status(
      v_app.id,
      's3_failed',
      format('Stage 3 below requirements (%s pts, Part A: %s, Part B: %s)', v_total_points, v_part_a, v_part_b)
    );
  end if;

  return v_stage_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Stage 1 IoT Foundation Screen (Prompts & Blueprints)
-- -----------------------------------------------------------------------------

-- 3.1 Stage 1 Part A (Written) Prompts for IoT
insert into public.prompts (id, track, stage, kind, title, prompt_text, target_words, max_duration_seconds, active)
values
  (
    '44444444-4444-4444-0101-000000000001',
    'iot', 1, 'text',
    'Desk vs Field Sensor Discrepancy',
    'A temperature and humidity sensor works accurately on your workbench breadboard, but once deployed inside a sealed solar-powered weather box in the field, its readings drift upward by 8°C and fluctuate erratically. Explain to a non-technical field project manager (in about 150 words) what physical or electrical factors are causing this difference, and what diagnostic steps you will take.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000002',
    'iot', 1, 'text',
    'Button Debouncing and Interrupt Storms',
    'An industrial operator pushes a physical cycle-start button once, but the microcontroller logs 14 rapid presses and triggers repeated state transitions. Explain to an operations lead (in about 150 words) why mechanical contacts chatter on a microsecond scale, why relying on software delay() loops inside interrupt handlers causes problems, and how to solve it properly.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000003',
    'iot', 1, 'text',
    'I2C Bus Capacitance on Extended Wiring',
    'A technician extends an I2C sensor bus over a 2-meter untwisted ribbon cable to reach an external tank, causing the microcontroller to hang completely during bus reads. Explain to a product coordinator (in about 150 words) why I2C was designed for single-circuit boards, how cable capacitance rounds signal edges, and what hardware change will restore communication.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000004',
    'iot', 1, 'text',
    'Deep Sleep Quiescent Current Leakage',
    'A battery-powered asset tracker designed to last 18 months in the field drains its Lithium battery completely after only 3 weeks, even though the firmware sleeps for 59 minutes each hour. Explain to a business manager (in about 150 words) how linear voltage regulators, floating GPIO pins, and sensor power rails leak current during sleep, and how you will audit the power budget.',
    150, 120, true
  )
on conflict (id) do update
set title = excluded.title,
    prompt_text = excluded.prompt_text,
    active = excluded.active;

-- 3.2 Stage 1 Part B (Video) Prompts for IoT
insert into public.prompts (id, track, stage, kind, title, prompt_text, target_words, max_duration_seconds, active)
values
  (
    '44444444-4444-4444-0101-000000000005',
    'iot', 1, 'video',
    '30% Fleet Drop-off Triage',
    'A client contacts support stating that 30% of their 500 newly deployed smart water meters went offline simultaneously yesterday afternoon. You have a 2-minute video recording with their operations director: state what 3 questions you ask first, what diagnostic telemetry you inspect on the broker/gateway, and what hypotheses you will test.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000006',
    'iot', 1, 'video',
    'Post-Thunderstorm Remote Sensor Failure',
    'A remote agricultural monitoring node ceased transmitting right after a severe thunderstorm in the area. In a 2-minute video, walk the local agricultural manager through how you will remotely verify whether the failure is cellular tower outage, solar battery discharge, or electrostatic surge damage to the board.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000007',
    'iot', 1, 'video',
    'OTA Fleet Rollout Bricking Incident',
    'An over-the-air (OTA) firmware upgrade deployed to 200 field devices resulted in 10 devices failing to reconnect. In a 2-minute video, explain to senior management what immediate containment steps you take, how A/B partition rollback protects surviving nodes, and how you will triage the unresponsive units.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0101-000000000008',
    'iot', 1, 'video',
    'Motor Activation ADC Noise',
    'In a medical cooler, the temperature reading spikes violently by 10°C whenever the cooling compressor motor turns on. In a 2-minute video, explain to the hardware engineering lead how inductive kickback and shared ground return paths corrupt analog ADC measurements, and what layout/isolation fixes you propose.',
    null, 120, true
  )
on conflict (id) do update
set title = excluded.title,
    prompt_text = excluded.prompt_text,
    active = excluded.active;

-- 3.3 Stage 1 Part C Blueprint for IoT (15 items: 5 logic, 5 probability, 5 charts)
insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('iot', 1, 'logic_patterns', 5, 40, 40, 20),
  ('iot', 1, 'probability_numeracy', 5, 40, 40, 20),
  ('iot', 1, 'charts_data', 5, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- 3.4 Seed 15 Fake Sample Stage 1 Questions for IoT
do $$
declare
  v_domains text[] := array['logic_patterns', 'probability_numeracy', 'charts_data'];
  v_diffs text[] := array['easy', 'easy', 'medium', 'medium', 'hard'];
  v_d_idx int;
  v_i int;
  v_seq int := 0;
  v_qid uuid;
  v_dom text;
  v_diff text;
begin
  for v_d_idx in 1..array_length(v_domains, 1) loop
    v_dom := v_domains[v_d_idx];
    for v_i in 1..5 loop
      v_seq := v_seq + 1;
      v_diff := v_diffs[v_i];
      v_qid := ('33333333-3333-3333-0101-' || lpad(v_seq::text, 12, '0'))::uuid;

      insert into public.questions (
        id, track, stage, domain, difficulty, type, stem, code_snippet, options, tolerance, active
      )
      values (
        v_qid,
        'iot',
        1,
        v_dom,
        v_diff,
        'mcq',
        format('[FAKE SAMPLE S1 IOT #%s - NOT REAL CONTENT] (%s / %s) Logic item %s for IoT Stage 1. Which option is correct?', v_seq, v_dom, v_diff, v_i),
        null,
        jsonb_build_array(
          jsonb_build_object('id', 'A', 'text', 'Option A (Correct IoT Stage 1 choice)'),
          jsonb_build_object('id', 'B', 'text', 'Option B (Distractor 1)'),
          jsonb_build_object('id', 'C', 'text', 'Option C (Distractor 2)'),
          jsonb_build_object('id', 'D', 'text', 'Option D (Distractor 3)')
        ),
        0,
        true
      )
      on conflict (id) do update
      set domain = excluded.domain,
          difficulty = excluded.difficulty,
          type = excluded.type,
          stem = excluded.stem,
          options = excluded.options,
          active = excluded.active;

      insert into public.question_keys (question_id, correct, explanation)
      values (
        v_qid,
        'A',
        format('Fake sample answer key for IoT S1 item #%s (%s)', v_seq, v_dom)
      )
      on conflict (question_id) do update
      set correct = excluded.correct,
          explanation = excluded.explanation;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Stage 2 IoT Technical Exam (40 Questions across 6 Domains)
-- -----------------------------------------------------------------------------

insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('iot', 2, 'electronics_hardware', 6, 40, 40, 20),
  ('iot', 2, 'embedded_programming', 8, 40, 40, 20),
  ('iot', 2, 'buses_wireless', 8, 40, 40, 20),
  ('iot', 2, 'iot_cloud_architecture', 6, 40, 40, 20),
  ('iot', 2, 'security_reliability', 6, 40, 40, 20),
  ('iot', 2, 'power_debugging_deployment', 6, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- Seed 48 Fake Sample Stage 2 IoT Questions (8 per domain: 3 easy, 3 medium, 2 hard)
do $$
declare
  v_domains text[] := array[
    'electronics_hardware',
    'embedded_programming',
    'buses_wireless',
    'iot_cloud_architecture',
    'security_reliability',
    'power_debugging_deployment'
  ];
  v_easy_counts int[] := array[3, 3, 3, 3, 3, 3];
  v_med_counts  int[] := array[3, 3, 3, 3, 3, 3];
  v_hard_counts int[] := array[2, 2, 2, 2, 2, 2];
  v_d_idx int;
  v_dom text;
  v_diff text;
  v_target int;
  v_i int;
  v_seq int := 0;
  v_qid uuid;
  v_type text;
  v_stem text;
  v_code text;
  v_options jsonb;
  v_tol numeric(10,4);
  v_correct text;
begin
  for v_d_idx in 1..array_length(v_domains, 1) loop
    v_dom := v_domains[v_d_idx];

    foreach v_diff in array array['easy', 'medium', 'hard'] loop
      v_target := case v_diff
        when 'easy' then v_easy_counts[v_d_idx]
        when 'medium' then v_med_counts[v_d_idx]
        else v_hard_counts[v_d_idx]
      end;

      for v_i in 1..v_target loop
        v_seq := v_seq + 1;
        v_qid := ('33333333-3333-3333-0102-' || lpad(v_seq::text, 12, '0'))::uuid;

        -- Realistic distribution: code reading on items 5, 12, 19, 27; numeric calculation on 1, 14, 30, 42
        if v_seq in (5, 12, 19, 27) then
          v_type := 'code_reading';
          v_code := format(
            E'// FAKE SAMPLE IOT SNIPPET #%s (%s)\nvoid IRAM_ATTR isr_handler() {\n  static volatile uint32_t count = 0;\n  count++;\n}',
            v_seq, v_dom
          );
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) What is the correct behaviour of the volatile variable inside this ISR?',
            v_seq, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', 'Forces compiler to read from RAM rather than caching in CPU register'),
            jsonb_build_object('id', 'B', 'text', 'Protects variable with a mutex lock automatically'),
            jsonb_build_object('id', 'C', 'text', 'Stores variable permanently in non-volatile flash memory'),
            jsonb_build_object('id', 'D', 'text', 'Prevents multiple interrupts from firing concurrently')
          );
          v_tol := 0;
          v_correct := 'A';
        elsif v_seq in (1, 14, 30, 42) then
          v_type := 'numeric';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) A 5.0V sensor output is connected to a 3.3V ADC pin via a voltage divider with R1=10 kΩ (top) and R2=20 kΩ (bottom). What is the output voltage at the ADC pin? (Tolerance ±0.05V)',
            v_seq, v_dom, v_diff
          );
          v_options := null;
          v_tol := 0.05;
          v_correct := '3.33';
        else
          v_type := 'mcq';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) IoT multiple-choice question for domain %s (%s difficulty). Which option is correct?',
            v_seq, v_dom, v_diff, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', 'Option A (Correct IoT technical choice)'),
            jsonb_build_object('id', 'B', 'text', 'Option B (Distractor 1)'),
            jsonb_build_object('id', 'C', 'text', 'Option C (Distractor 2)'),
            jsonb_build_object('id', 'D', 'text', 'Option D (Distractor 3)')
          );
          v_tol := 0;
          v_correct := 'A';
        end if;

        insert into public.questions (
          id, track, stage, domain, difficulty, type, stem, code_snippet, options, tolerance, active
        )
        values (
          v_qid, 'iot', 2, v_dom, v_diff, v_type, v_stem, v_code, v_options, v_tol, true
        )
        on conflict (id) do update
        set domain = excluded.domain,
            difficulty = excluded.difficulty,
            type = excluded.type,
            stem = excluded.stem,
            code_snippet = excluded.code_snippet,
            options = excluded.options,
            tolerance = excluded.tolerance,
            active = excluded.active;

        insert into public.question_keys (question_id, correct, explanation)
        values (
          v_qid,
          v_correct,
          format('Fake sample answer key for IoT item #%s (%s)', v_seq, v_dom)
        )
        on conflict (question_id) do update
        set correct = excluded.correct,
            explanation = excluded.explanation;
      end loop;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Stage 3 IoT Practical Project Scenario & Rubrics
-- -----------------------------------------------------------------------------

-- 5.1 Scenario A: Cold-Chain Vaccine Transport Monitor
insert into public.scenarios (
  id,
  track,
  version,
  title,
  description,
  kit_path,
  hidden_paths,
  config,
  active
)
values (
  '66666666-6666-6666-0103-000000000001',
  'iot',
  'v1.0',
  '[FAKE SAMPLE - NOT REAL CONTENT] Cold-Chain Vaccine Transport Monitor',
  'Build resilient ESP32 virtual peripheral firmware and cloud ingestion service for vaccine cold-chain monitoring with spike filtering, 120s offline buffering, and sustained temperature alerts.',
  'iot-stage3-starter-kit.zip',
  '{"hidden_test_path": "iot-stage3-hidden-scenarios.json", "practice_data_path": "iot-stage3-practice-scenarios.json"}'::jsonb,
  '{"time_limit_hours": 5, "max_pause_minutes": 30}'::jsonb,
  true
)
on conflict (track, version) do update
set title = excluded.title,
    description = excluded.description,
    kit_path = excluded.kit_path,
    hidden_paths = excluded.hidden_paths,
    config = excluded.config,
    active = excluded.active;

-- 5.2 Stage 3 Reviewer Rubric for IoT (C: 15, D: 10, E: 10 = 35 pts)
insert into public.rubrics (id, stage, track, part, title, description, active)
values (
  '55555555-5555-5555-0103-000000000001',
  3,
  'iot',
  's3_project',
  'IoT Track Stage 3 Practical Project Rubric',
  'Reviewer scoring criteria for IoT Stage 3 Practical Project (C: Design review, D: Code quality & security, E: Write-up)',
  true
)
on conflict (stage, track, part) do update
set title = excluded.title,
    description = excluded.description,
    active = excluded.active;

insert into public.rubric_criteria (id, rubric_id, slug, criterion, weight, scale_min, scale_max, anchors, sort_order)
values
  (
    '55555555-5555-5555-0103-000000000002',
    '55555555-5555-5555-0103-000000000001',
    'C_design_review',
    'C: Hardware Design, Pin Mapping & Power Budget',
    15.0, 1, 4,
    '{"1": "Missing pin map, unrealistic power budget (ignores sleep leakage), no security or OTA plan.", "2": "Basic pin map but uses strapping pins inappropriately; superficial power calculation.", "3": "Sound pin mapping with pull-ups/decoupling specified, realistic battery life model, clear mTLS/OTA design.", "4": "Production-ready schematic reasoning: ESD protection, sleep rail isolation, rigorous multi-year battery lifetime model."}'::jsonb,
    1
  ),
  (
    '55555555-5555-5555-0103-000000000003',
    '55555555-5555-5555-0103-000000000001',
    'D_code_security',
    'D: Code Quality, Memory Safety & Security Hygiene',
    10.0, 1, 4,
    '{"1": "Hardcoded Wi-Fi/MQTT credentials, blocking delay() calls in loops, unbuffered buffer overflows.", "2": "Credentials extracted to config but cleartext connections used; tight busy waiting present.", "3": "Clean modular code, TLS encryption enabled, defensive JSON parsing, proper non-blocking timers.", "4": "Exemplary embedded code: MISRA/defensive guidelines, zero memory leaks, watchdog integration, robust error recovery."}'::jsonb,
    2
  ),
  (
    '55555555-5555-5555-0103-000000000004',
    '55555555-5555-5555-0103-000000000001',
    'E_writeup',
    'E: Technical Write-up & Analytical Maturity',
    10.0, 1, 4,
    '{"1": "Missing write-up or overclaims perfection without analyzing limitations or field failure modes.", "2": "Brief summary of what was built without discussing real-world edge cases or power trade-offs.", "3": "Clear explanation of results, candid analysis of buffer limitations, pragmatic trade-offs acknowledged.", "4": "Exceptional maturity: transparently identifies field failure risks, quantifies battery degradation, outlines robust OTA rollback roadmap."}'::jsonb,
    3
  )
on conflict (id) do update
set criterion = excluded.criterion,
    weight = excluded.weight,
    anchors = excluded.anchors,
    sort_order = excluded.sort_order;
