-- =============================================================================
-- Migration 0010: Milestone 8 (M8) - Robotics Track
-- Per AGENTS.md & docs/blueprint-robotics.md:
-- 1. Stage 1 Robotics Foundation Screen:
--    - Blueprints (logic_patterns 5, probability_numeracy 5, charts_data 5)
--    - Rotating prompts (4 written, 4 video)
--    - 15 clearly marked fake sample logic & numeracy questions + keys
-- 2. Stage 2 Robotics Technical Exam:
--    - Blueprints (40 questions across 6 domains: tooling_math_ros 6, control_kinematics 8, perception_estimation 8, navigation_planning 6, hardware_safety 6, deployment_lifecycle 6)
--    - 48 fake sample questions (8 per domain: 3 easy, 3 medium, 2 hard) with MCQ, code reading, and numeric calculations + keys
-- 3. Stage 3 Robotics Practical Project Scenario & Rubrics:
--    - Scenario: Autonomous Warehouse Delivery Robot (robot_sim)
--    - Rubric: Stage 3 Robotics Project (C: 15, D: 10, E: 10)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Stage 1 Robotics Foundation Screen (Prompts & Blueprints)
-- -----------------------------------------------------------------------------

-- 1.1 Stage 1 Part A (Written) Prompts for Robotics
insert into public.prompts (id, track, stage, kind, title, prompt_text, target_words, max_duration_seconds, active)
values
  (
    '44444444-4444-4444-0201-000000000001',
    'robotics', 1, 'text',
    'URDF Joint Limits and Transform Frames',
    'A mobile manipulator arm fails to reach a target bin because the transform from base_link to arm_base was defined with inverted roll-pitch-yaw rotations in the URDF. Explain to a non-technical project lead (in about 150 words) what a coordinate transform tree is, why inverse kinematics fails when frame orientations are inverted, and how you will verify the TF tree.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000002',
    'robotics', 1, 'text',
    'PID Tuning and Integral Windup',
    'A mobile base carrying a heavy payload experiences violent speed oscillations and overshoots waypoints whenever it accelerates from a stop. Explain to an operations supervisor (in about 150 words) what proportional, integral, and derivative terms control, how actuator saturation causes integral windup, and how clamping stops the surging.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000003',
    'robotics', 1, 'text',
    'LiDAR Specular Reflection on Glossy Floors',
    'In a polished warehouse, a 2D LiDAR reports zero obstacles ahead even when facing a clear plastic partition or high-gloss metal shelving. Explain to a warehouse manager (in about 150 words) why laser beams reflect away rather than returning to the receiver, and why combining LiDAR with ultrasonic or depth camera sensors is necessary for industrial safety.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000004',
    'robotics', 1, 'text',
    'ROS 2 Executor Starvation by Blocking Callbacks',
    'A robot control node stops processing urgent laser safety scans whenever it runs an image-processing function in its timer callback. Explain to an engineering coordinator (in about 150 words) why single-threaded event loops block when callbacks take too long, and how assigning separate callback groups with a multithreaded executor prevents starvation.',
    150, 120, true
  )
on conflict (id) do update
set title = excluded.title,
    prompt_text = excluded.prompt_text,
    active = excluded.active;

-- 1.2 Stage 1 Part B (Video) Prompts for Robotics
insert into public.prompts (id, track, stage, kind, title, prompt_text, target_words, max_duration_seconds, active)
values
  (
    '44444444-4444-4444-0201-000000000005',
    'robotics', 1, 'video',
    'Emergency Stop Circuit vs Safety Laser Field',
    'An automated forklift failed to stop when a worker stepped into its deceleration zone, requiring a manual E-stop hit. In a 2-minute video, explain to the safety director how you isolate whether the fault is in the safety laser zone configuration, the safety PLC relay, or the motor driver brake engagement.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000006',
    'robotics', 1, 'video',
    'Odometry Drift on Slippery Flooring',
    'A wheeled AMR tracking position using wheel encoders alone is off by 2 meters after traveling only 20 meters across smooth epoxy flooring. In a 2-minute video, explain to the logistics director why wheel slip corrupts dead reckoning, and how combining wheel ticks with IMU angular rates in an Extended Kalman Filter restores accuracy.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000007',
    'robotics', 1, 'video',
    'Sim-to-Real Trajectory Discrepancy',
    'A high-speed docking trajectory that executes flawlessly in Gazebo simulation consistently skids and misses the charger on physical hardware. In a 2-minute video, explain to senior management what physical factors Gazebo ignores (gearbox backlash, motor voltage sag, friction non-linearities), and how you will calibrate the simulation.',
    null, 120, true
  ),
  (
    '44444444-4444-4444-0201-000000000008',
    'robotics', 1, 'video',
    'Two-Robot Narrow Aisle Deadlock',
    'Two autonomous carts meet head-on inside a single-lane warehouse aisle and enter an infinite oscillation trying to dodge each other. In a 2-minute video, outline the fleet traffic management protocol (priority yield, aisle reservation tokens, and designated passing bays) that eliminates this deadlock permanently.',
    null, 120, true
  )
on conflict (id) do update
set title = excluded.title,
    prompt_text = excluded.prompt_text,
    active = excluded.active;

-- 1.3 Stage 1 Part C Blueprint for Robotics
insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('robotics', 1, 'logic_patterns', 5, 40, 40, 20),
  ('robotics', 1, 'probability_numeracy', 5, 40, 40, 20),
  ('robotics', 1, 'charts_data', 5, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- 1.4 Seed 15 Fake Sample Stage 1 Questions for Robotics
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
      v_qid := ('33333333-3333-3333-0201-' || lpad(v_seq::text, 12, '0'))::uuid;

      insert into public.questions (
        id, track, stage, domain, difficulty, type, stem, code_snippet, options, tolerance, active
      )
      values (
        v_qid,
        'robotics',
        1,
        v_dom,
        v_diff,
        'mcq',
        format('[FAKE SAMPLE S1 ROBOTICS #%s - NOT REAL CONTENT] (%s / %s) Logic item %s for Robotics Stage 1. Which option is correct?', v_seq, v_dom, v_diff, v_i),
        null,
        jsonb_build_array(
          jsonb_build_object('id', 'A', 'text', 'Option A (Correct Robotics Stage 1 choice)'),
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
        format('Fake sample answer key for Robotics S1 item #%s (%s)', v_seq, v_dom)
      )
      on conflict (question_id) do update
      set correct = excluded.correct,
          explanation = excluded.explanation;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Stage 2 Robotics Technical Exam (40 Questions across 6 Domains)
-- -----------------------------------------------------------------------------

insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('robotics', 2, 'tooling_math_ros', 6, 40, 40, 20),
  ('robotics', 2, 'control_kinematics', 8, 40, 40, 20),
  ('robotics', 2, 'perception_estimation', 8, 40, 40, 20),
  ('robotics', 2, 'navigation_planning', 6, 40, 40, 20),
  ('robotics', 2, 'hardware_safety', 6, 40, 40, 20),
  ('robotics', 2, 'deployment_lifecycle', 6, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- Seed 48 Fake Sample Stage 2 Robotics Questions (8 per domain: 3 easy, 3 medium, 2 hard)
do $$
declare
  v_domains text[] := array[
    'tooling_math_ros',
    'control_kinematics',
    'perception_estimation',
    'navigation_planning',
    'hardware_safety',
    'deployment_lifecycle'
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
        v_qid := ('33333333-3333-3333-0202-' || lpad(v_seq::text, 12, '0'))::uuid;

        -- Code reading on items 4, 11, 20, 28; numeric calculation on 2, 13, 29, 41
        if v_seq in (4, 11, 20, 28) then
          v_type := 'code_reading';
          v_code := format(
            E'// FAKE SAMPLE ROBOTICS SNIPPET #%s (%s)\ngeometry_msgs::msg::Twist cmd;\ncmd.linear.x = 0.5;\ncmd.angular.z = -0.2;\npublisher_->publish(cmd);',
            v_seq, v_dom
          );
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) What physical motion does this Twist command produce on a differential drive robot?',
            v_seq, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', 'Forward driving with a clockwise (rightward) curve'),
            jsonb_build_object('id', 'B', 'text', 'Reverse driving with a counter-clockwise curve'),
            jsonb_build_object('id', 'C', 'text', 'Pure in-place counter-clockwise rotation'),
            jsonb_build_object('id', 'D', 'text', 'Pure lateral strafing to the right')
          );
          v_tol := 0;
          v_correct := 'A';
        elsif v_seq in (2, 13, 29, 41) then
          v_type := 'numeric';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) A differential drive robot has wheel radius r = 0.10 m. If both wheels rotate forward at angular velocity ω = 5.0 rad/s, what is the robot forward linear velocity v in m/s? (Tolerance ±0.05)',
            v_seq, v_dom, v_diff
          );
          v_options := null;
          v_tol := 0.05;
          v_correct := '0.50';
        else
          v_type := 'mcq';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) Robotics multiple-choice question for domain %s (%s difficulty). Which option is correct?',
            v_seq, v_dom, v_diff, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', 'Option A (Correct Robotics technical choice)'),
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
          v_qid, 'robotics', 2, v_dom, v_diff, v_type, v_stem, v_code, v_options, v_tol, true
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
          format('Fake sample answer key for Robotics item #%s (%s)', v_seq, v_dom)
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
-- 3. Stage 3 Robotics Practical Project Scenario & Rubrics
-- -----------------------------------------------------------------------------

-- 3.1 Scenario A: Autonomous Warehouse Delivery Robot
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
  '66666666-6666-6666-0203-000000000001',
  'robotics',
  'v1.0',
  '[FAKE SAMPLE - NOT REAL CONTENT] Autonomous Warehouse Delivery Robot',
  'Build 2D unicycle kinematic controller and ArUco marker pose docking estimator for warehouse AMR with obstacle avoidance, speed governing, and sensor loss emergency stop.',
  'robotics-stage3-starter-kit.zip',
  '{"hidden_test_path": "robotics-stage3-hidden-scenarios.json", "practice_data_path": "robotics-stage3-practice-scenarios.json"}'::jsonb,
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

-- 3.2 Stage 3 Reviewer Rubric for Robotics (C: 15, D: 10, E: 10 = 35 pts)
insert into public.rubrics (id, stage, track, part, title, description, active)
values (
  '55555555-5555-5555-0203-000000000001',
  3,
  'robotics',
  's3_project',
  'Robotics Track Stage 3 Practical Project Rubric',
  'Reviewer scoring criteria for Robotics Stage 3 Practical Project (C: Design & safety review, D: Code quality & ROS practice, E: Write-up)',
  true
)
on conflict (stage, track, part) do update
set title = excluded.title,
    description = excluded.description,
    active = excluded.active;

insert into public.rubric_criteria (id, rubric_id, slug, criterion, weight, scale_min, scale_max, anchors, sort_order)
values
  (
    '55555555-5555-5555-0203-000000000002',
    '55555555-5555-5555-0203-000000000001',
    'C_design_safety',
    'C: Architecture, Transform Tree & Safety Review',
    15.0, 1, 4,
    '{"1": "Missing node/topic diagram, broken transform tree, no safety watchdog or failure modes analyzed.", "2": "Basic diagram but omits frame conventions; superficial discussion of physical failure modes.", "3": "Clean node/topic architecture, valid TF tree (odom->base_link->sensor), realistic failure mode mitigations, sound sim-to-real reasoning.", "4": "Production-grade industrial safety architecture: ISO 3691-4 laser zones, dual-channel E-stop reasoning, thorough sim-to-real calibration plan."}'::jsonb,
    1
  ),
  (
    '55555555-5555-5555-0203-000000000003',
    '55555555-5555-5555-0203-000000000001',
    'D_code_ros',
    'D: Code Quality, ROS 2 Conventions & Modularity',
    10.0, 1, 4,
    '{"1": "Hardcoded file paths, monolithic script without nodes, blocking loops inside callbacks.", "2": "Basic ROS 2 structure but lacks launch files; mixed responsibilities in single callback.", "3": "Modular ROS 2 packages, clean launch configuration, declared parameters, non-blocking callback groups.", "4": "Exemplary robotics engineering: managed lifecycle nodes, diagnostic telemetry publishers, defensive TF lookups, clean Docker packaging."}'::jsonb,
    2
  ),
  (
    '55555555-5555-5555-0203-000000000004',
    '55555555-5555-5555-0203-000000000001',
    'E_writeup',
    'E: Technical Write-up & Analytical Maturity',
    10.0, 1, 4,
    '{"1": "Missing write-up or exaggerates performance without discussing edge cases or obstacle clearances.", "2": "Brief summary of implementation without analyzing trajectory jitter, lag, or controller limitations.", "3": "Honest evaluation of docking tolerances, insightful discussion of wheel slip vs odometry, clear production roadmap.", "4": "Exceptional maturity: quantitative error budget, transparent analysis of corner cases, pragmatic trade-offs between speed and safety."}'::jsonb,
    3
  )
on conflict (id) do update
set criterion = excluded.criterion,
    weight = excluded.weight,
    anchors = excluded.anchors,
    sort_order = excluded.sort_order;

