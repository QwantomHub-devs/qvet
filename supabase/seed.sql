-- =============================================================================
-- Seed Data for Local Development & Reproducible Rebuilds
-- 1. Runtime configuration settings (Rule 9 of AGENTS.md)
-- 2. Initial partner institutions and cohorts
-- 3. Provisioned Admin, Reviewer, and Candidate test accounts
-- =============================================================================

-- 1. Runtime Settings (Starting values from AI, IoT, and Robotics blueprints)
insert into public.settings (key, value, description)
values
  (
    'stage_weights',
    '{"stage_1": 0.15, "stage_2": 0.25, "stage_3": 0.35, "stage_4": 0.25}'::jsonb,
    'Weights for computing overall score: 0.15 * S1 + 0.25 * S2 + 0.35 * S3 + 0.25 * S4'
  ),
  (
    'stage_pass_minimums',
    '{"stage_1_pct": 60, "stage_2_pct": 60, "stage_3_pct": 60, "stage_3_part_min_pct": 40, "stage_4_avg": 2.5, "stage_4_min_understanding": 2}'::jsonb,
    'Minimum score required in each stage to advance and qualify for certification'
  ),
  (
    'tier_thresholds',
    '{"certified": {"overall": 70}, "certified_pro": {"overall": 80, "stage_3_min": 75}, "elite": {"overall": 90, "stage_4_avg_min": 3.5}}'::jsonb,
    'Thresholds for Certified, Certified Pro, and Elite credential tiers'
  ),
  (
    'timers',
    '{"stage_0_minutes": 15, "stage_1_minutes": 45, "stage_1_part_a_minutes": 15, "stage_1_part_b_minutes": 10, "stage_1_part_c_minutes": 20, "stage_2_minutes": 60, "stage_3_hours": 5, "stage_3_pause_minutes": 30, "stage_4_minutes": 40}'::jsonb,
    'Server-enforced duration limits for each stage and allowed session pause'
  ),
  (
    'retake_policy',
    '{"wait_days": 60, "max_retakes_per_year": 2}'::jsonb,
    'Cooldown period and annual cap for retaking a failed stage'
  ),
  (
    'project_limits',
    '{"runs_allowed": 10}'::jsonb,
    'Maximum number of practice grading runs allowed on visible data in Stage 3'
  ),
  (
    'credential_validity',
    '{"months": 24}'::jsonb,
    'Months before an issued credential expires'
  ),
  (
    'max_id_upload_bytes',
    '{"bytes": 5242880}'::jsonb,
    'Maximum file size for government ID uploads (5 MB)'
  ),
  (
    'max_video_upload_bytes',
    '{"bytes": 26214400}'::jsonb,
    'Maximum file size for Stage 1 recorded video responses (25 MB)'
  ),
  (
    'stage_3_a1_thresholds',
    '{"f1_min": 0.40, "f1_max": 0.85, "max_points": 15}'::jsonb,
    'Macro-F1 baseline and ceiling thresholds for mapping Stage 3 Part A1 predictions to 0-15 points'
  ),
  (
    'max_project_upload_bytes',
    '{"predictions": 2097152, "retrieval": 1048576, "notebook": 10485760, "code": 15728640, "writeup": 2097152}'::jsonb,
    'Maximum byte limits per Stage 3 submission artifact'
  )
on conflict (key) do update
set value = excluded.value,
    description = excluded.description;

-- 2. Partner Institutions & Cohorts
insert into public.institutions (id, name, country, partner_code, active)
values
  ('11111111-1111-1111-1111-111111111101', 'University of Lagos (UNILAG)', 'Nigeria', 'UNILAG-NG', true),
  ('11111111-1111-1111-1111-111111111102', 'Ahmadu Bello University (ABU)', 'Nigeria', 'ABU-NG', true),
  ('11111111-1111-1111-1111-111111111103', 'University of Nigeria, Nsukka (UNN)', 'Nigeria', 'UNN-NG', true),
  ('11111111-1111-1111-1111-111111111104', 'AltSchool Africa', 'Nigeria', 'ALTSCHOOL', true)
on conflict (id) do update
set name = excluded.name,
    country = excluded.country,
    partner_code = excluded.partner_code,
    active = excluded.active;

insert into public.cohorts (id, name, institution_id, track, opens_at, closes_at)
values
  (
    '22222222-2222-2222-2222-222222222201',
    '2026 Pilot Cohort - AI Track',
    '11111111-1111-1111-1111-111111111101',
    'ai',
    now() - interval '7 days',
    now() + interval '60 days'
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    '2026 Pilot Cohort - IoT Track',
    '11111111-1111-1111-1111-111111111102',
    'iot',
    now() - interval '7 days',
    now() + interval '60 days'
  ),
  (
    '22222222-2222-2222-2222-222222222203',
    '2026 Pilot Cohort - Robotics Track',
    '11111111-1111-1111-1111-111111111103',
    'robotics',
    now() - interval '7 days',
    now() + interval '60 days'
  )
on conflict (id) do nothing;

-- 3. Provisioned Accounts (Admin, Reviewers, and Sample Candidates)
-- Default password for all seeded accounts: Password123!
do $$
declare
  v_users jsonb := '[
    {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@vetting.local", "role": "admin", "full_name": "Platform Administrator", "inst_id": null},
    {"id": "00000000-0000-0000-0000-000000000002", "email": "reviewer1@vetting.local", "role": "reviewer", "full_name": "Dr. Adaobi Nwachukwu", "inst_id": "11111111-1111-1111-1111-111111111101"},
    {"id": "00000000-0000-0000-0000-000000000003", "email": "reviewer2@vetting.local", "role": "reviewer", "full_name": "Engr. Tunde Bakare", "inst_id": "11111111-1111-1111-1111-111111111102"},
    {"id": "00000000-0000-0000-0000-000000000004", "email": "candidate1@vetting.local", "role": "candidate", "full_name": "Chinedu Okafor", "inst_id": "11111111-1111-1111-1111-111111111101"},
    {"id": "00000000-0000-0000-0000-000000000005", "email": "candidate2@vetting.local", "role": "candidate", "full_name": "Amina Yusuf", "inst_id": "11111111-1111-1111-1111-111111111102"},
    {"id": "00000000-0000-0000-0000-000000000006", "email": "reviewer3@vetting.local", "role": "reviewer", "full_name": "Dr. Kemi Adeyemi", "inst_id": "11111111-1111-1111-1111-111111111103"},
    {"id": "00000000-0000-0000-0000-000000000007", "email": "reviewer4@vetting.local", "role": "reviewer", "full_name": "Engr. Ibrahim Musa", "inst_id": "11111111-1111-1111-1111-111111111104"},
    {"id": "00000000-0000-0000-0000-000000000008", "email": "grader@vetting.local", "role": "grader", "full_name": "Automated Grader Worker", "inst_id": null}
  ]'::jsonb;
  v_u jsonb;
  v_uid uuid;
begin
  for v_u in select * from jsonb_array_elements(v_users)
  loop
    v_uid := (v_u->>'id')::uuid;

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_u->>'email',
      extensions.crypt('Password123!', extensions.gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', v_u->>'role'),
      jsonb_build_object('full_name', v_u->>'full_name'),
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_uid,
      v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_u->>'email', 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    )
    on conflict (provider_id, provider) do nothing;

    update public.profiles
    set full_name = v_u->>'full_name',
        institution_id = (v_u->>'inst_id')::uuid,
        country = 'Nigeria'
    where user_id = v_uid;
  end loop;
end;
$$;


-- =============================================================================
-- 4. Milestone 2 (M2): AI Track Stage 2 Exam Blueprints & Fake Sample Questions
-- NOTE: All seeded questions below are clearly marked FAKE SAMPLE questions for
-- testing the exam engine only. Do NOT use them as real assessment content.
-- =============================================================================

insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('ai', 2, 'python_data', 8, 40, 40, 20),
  ('ai', 2, 'stats_ml', 10, 40, 40, 20),
  ('ai', 2, 'eval_debugging', 8, 40, 40, 20),
  ('ai', 2, 'dl_nlp', 4, 40, 40, 20),
  ('ai', 2, 'llm_apps', 6, 40, 40, 20),
  ('ai', 2, 'eng_practice', 4, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- Seed 40 clearly marked FAKE SAMPLE questions matching the exact AI Stage 2 blueprint
-- (plus 8 extra fake buffer items so every domain/difficulty has surplus for random draws)
do $$
declare
  v_domains text[] := array[
    'python_data',
    'stats_ml',
    'eval_debugging',
    'dl_nlp',
    'llm_apps',
    'eng_practice'
  ];
  v_easy_counts int[] := array[3, 4, 3, 2, 2, 2];   -- sum = 16 (40% of 40)
  v_med_counts  int[] := array[4, 4, 3, 1, 3, 1];   -- sum = 16 (40% of 40)
  v_hard_counts int[] := array[1, 2, 2, 1, 1, 1];   -- sum = 8  (20% of 40)
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
        v_qid := ('33333333-3333-3333-3333-' || lpad(v_seq::text, 12, '0'))::uuid;

        -- Include 6 code_reading items and 4 numeric-with-tolerance items across the 40 fake sample questions
        if v_seq in (3, 7, 15, 22, 31, 37) then
          v_type := 'code_reading';
          v_code := format(
            E'# FAKE SAMPLE SNIPPET #%s (%s)\nimport pandas as pd\ndf = pd.DataFrame({"x": [1, 2, None, 4]})\nprint(len(df.dropna()))',
            v_seq, v_dom
          );
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) What does the sample code snippet print?',
            v_seq, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', '3 (rows remaining after dropping missing values)'),
            jsonb_build_object('id', 'B', 'text', '4 (all rows kept)'),
            jsonb_build_object('id', 'C', 'text', '1 (only missing row)'),
            jsonb_build_object('id', 'D', 'text', 'Raises a ValueError')
          );
          v_tol := 0;
          v_correct := 'A';
        elsif v_seq in (10, 20, 30, 40) then
          v_type := 'numeric';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) In this synthetic test item, if precision is 0.80 and recall is 0.80, what is the F1 score? (Tolerance ±0.02)',
            v_seq, v_dom, v_diff
          );
          v_options := null;
          v_tol := 0.02;
          v_correct := '0.80';
        else
          v_type := 'mcq';
          v_code := null;
          v_stem := format(
            '[FAKE SAMPLE #%s - NOT REAL CONTENT] (%s / %s) Placeholder multiple-choice question %s for domain %s (%s difficulty). Which option is marked correct for testing?',
            v_seq, v_dom, v_diff, v_i, v_dom, v_diff
          );
          v_options := jsonb_build_array(
            jsonb_build_object('id', 'A', 'text', 'Option A (Correct test choice)'),
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
          v_qid, 'ai', 2, v_dom, v_diff, v_type, v_stem, v_code, v_options, v_tol, true
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
          format('Fake sample answer key for item #%s (%s)', v_seq, v_dom)
        )
        on conflict (question_id) do update
        set correct = excluded.correct,
            explanation = excluded.explanation;
      end loop;
    end loop;
  end loop;
end;
$$;


-- =============================================================================
-- 5. Milestone 3 (M3): Stage 1 Rotating Prompts, Rubrics & Part C Logic Bank
-- =============================================================================

-- 5.1 Rotating Stage 1 Prompts (4 Written + 4 Video for AI Track)
insert into public.prompts (id, track, stage, kind, title, prompt_text, target_words, max_duration_seconds, active)
values
  (
    '44444444-4444-4444-4444-000000000001',
    'ai', 1, 'text',
    'Explaining High Accuracy on Imbalanced Data',
    'A fraud detection model reaches 95% accuracy on historical transactions, where only 5% of transactions are fraudulent. Explain to a non-technical operations manager (in about 150 words) why this 95% accurate model may still be useless in production, and what you would check instead.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000002',
    'ai', 1, 'text',
    'Explaining Data Leakage to a Product Lead',
    'A teammate trained a customer churn model that scored 99% accuracy during testing, but failed badly in its first week with real customers. Explain to a non-technical product manager (in about 150 words) how future information can accidentally leak into training data and how you prevent it.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000003',
    'ai', 1, 'text',
    'Why AI Assistants Hallucinate',
    'Your company wants to connect a language model to internal support documents. Explain to a non-technical manager (in about 150 words) why a language model can still give confident wrong answers and what practical safeguards reduce this risk.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000004',
    'ai', 1, 'text',
    'When Simple Rules Beat Machine Learning',
    'A manager asks you to train a deep learning model to sort incoming invoices by currency and total amount. Explain to them in plain English (in about 150 words) why a deterministic rule or simple script is better here and when machine learning actually makes sense.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000005',
    'ai', 1, 'video',
    'Pushing Back on an Unready Deployment',
    'A client asks you to deploy a prediction model to production tomorrow morning, but your evaluation shows it fails on an important group of users. Record a 2-minute video explaining what you would say to the client, what evidence you would show, and what next step you would propose.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000006',
    'ai', 1, 'video',
    'Handling Unclear Requirements Quickly',
    'You are working remotely and discover halfway through a sprint that the dataset labels do not match what the business team described. Record a 2-minute video explaining how you investigate the mismatch and communicate the impact to your team lead.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000007',
    'ai', 1, 'video',
    'Diagnosing a Sudden Drop in Model Quality',
    'Users report that your deployed support-ticket classifier started misclassifying urgent tickets this week even though no code changed. Record a 2-minute video walking through the first three things you would check and how you would update stakeholders.',
    150, 120, true
  ),
  (
    '44444444-4444-4444-4444-000000000008',
    'ai', 1, 'video',
    'Admitting a Mistake in an Evaluation Report',
    'After sharing promising model metrics with your team, you realise your evaluation script included duplicate rows between the training and test sets. Record a 2-minute video explaining how you handle the situation with your team.',
    150, 120, true
  )
on conflict (id) do update
set title = excluded.title,
    prompt_text = excluded.prompt_text,
    active = excluded.active;

-- 5.2 Editable Stage 1 Rubrics & Criteria (Section 4 of blueprint-ai.md)
insert into public.rubrics (id, stage, track, part, title, description, active)
values
  (
    '55555555-5555-5555-5555-000000000001',
    1, 'all', 's1_text',
    'Stage 1 Part A: Written Explanation Rubric',
    'Scores the candidate''s ~150-word technical explanation for a non-technical manager (1 to 4 per criterion).',
    true
  ),
  (
    '55555555-5555-5555-5555-000000000002',
    1, 'all', 's1_video',
    'Stage 1 Part B: Recorded Video Scenario Rubric',
    'Scores the candidate''s 2-minute recorded response to a realistic remote engineering scenario (1 to 4 per criterion).',
    true
  )
on conflict (id) do update
set title = excluded.title,
    description = excluded.description,
    active = excluded.active;

insert into public.rubric_criteria (id, rubric_id, slug, criterion, weight, scale_min, scale_max, anchors, sort_order)
values
  -- Part A (s1_text): clarity, structure, accuracy, grammar
  (
    '66666666-6666-6666-6666-000000000001',
    '55555555-5555-5555-5555-000000000001',
    'clarity',
    'Clarity for a Non-Technical Reader',
    1.0, 1, 4,
    '{"1": "Heavy jargon or confusing phrasing; a non-technical manager cannot follow the point.", "2": "Main point is visible with effort, but relies on undefined technical terms.", "3": "Clear, plain English explanation that a non-technical manager can immediately understand.", "4": "Exceptionally clear and concrete; uses a helpful everyday example without talking down to the reader."}'::jsonb,
    1
  ),
  (
    '66666666-6666-6666-6666-000000000002',
    '55555555-5555-5555-5555-000000000001',
    'structure',
    'Structure and Conciseness',
    1.0, 1, 4,
    '{"1": "Disorganised or rambling; misses the core question or far outside the target length.", "2": "Covers some points but jumps between ideas without a clear conclusion.", "3": "Logical progression (problem, why it happens, what to do next) within roughly 150 words.", "4": "Crisp, well-structured paragraphs where every sentence adds value and leads to a clear action."}'::jsonb,
    2
  ),
  (
    '66666666-6666-6666-6666-000000000003',
    '55555555-5555-5555-5555-000000000001',
    'accuracy',
    'Technical Accuracy',
    1.0, 1, 4,
    '{"1": "Contains fundamental technical misconceptions or proposes an invalid fix.", "2": "Partially accurate but glosses over the key mechanism or recommends a weak check.", "3": "Technically sound explanation of both the underlying issue and the practical remedy.", "4": "Precise and insightful; accurately captures nuances and trade-offs while staying accessible."}'::jsonb,
    3
  ),
  (
    '66666666-6666-6666-6666-000000000004',
    '55555555-5555-5555-5555-000000000001',
    'grammar',
    'Grammar and Readability',
    1.0, 1, 4,
    '{"1": "Frequent errors make the meaning ambiguous or difficult to read.", "2": "Noticeable errors that slow down reading, though the overall meaning is recoverable.", "3": "Clean, readable sentences suitable for written workplace communication.", "4": "Polished, natural professional writing with zero ambiguity."}'::jsonb,
    4
  ),
  -- Part B (s1_video): clarity, reasoning, professionalism
  (
    '66666666-6666-6666-6666-000000000005',
    '55555555-5555-5555-5555-000000000002',
    'clarity',
    'Spoken Clarity',
    1.0, 1, 4,
    '{"1": "Hard to follow; unstructured or fails to address the scenario.", "2": "Understandable with effort; repeats points or buries the main message.", "3": "Communicates clearly and directly within the 2-minute window.", "4": "Structured, concise, and adapts tone effectively for a remote engineering team."}'::jsonb,
    1
  ),
  (
    '66666666-6666-6666-6666-000000000006',
    '55555555-5555-5555-5555-000000000002',
    'reasoning',
    'Engineering Reasoning and Judgment',
    1.0, 1, 4,
    '{"1": "Ignores the risk or proposes reckless action without checking evidence.", "2": "Identifies the problem but offers a vague or impractical next step.", "3": "Proposes sensible diagnostic steps, explains trade-offs, and recommends a realistic path.", "4": "Strong engineering judgment: balances business urgency with technical risk and proposes concrete verification."}'::jsonb,
    2
  ),
  (
    '66666666-6666-6666-6666-000000000007',
    '55555555-5555-5555-5555-000000000002',
    'professionalism',
    'Honesty and Professionalism',
    1.0, 1, 4,
    '{"1": "Bluffs, blames others, or dismisses stakeholder concerns.", "2": "Defensive or overly passive when explaining risks.", "3": "Calm, honest about limitations, and respectful of stakeholders.", "4": "Demonstrates mature ownership: transparent about risks and constructive about solutions."}'::jsonb,
    3
  )
on conflict (id) do update
set criterion = excluded.criterion,
    anchors = excluded.anchors,
    sort_order = excluded.sort_order;

-- 5.3 Stage 1 Part C Blueprint (15 Logic & Numeracy Questions, 20 minutes)
insert into public.exam_blueprints (track, stage, domain, count, easy_pct, medium_pct, hard_pct)
values
  ('ai', 1, 'logic_patterns', 5, 40, 40, 20),
  ('ai', 1, 'probability_numeracy', 5, 40, 40, 20),
  ('ai', 1, 'charts_data', 5, 40, 40, 20)
on conflict (track, stage, domain) do update
set count = excluded.count,
    easy_pct = excluded.easy_pct,
    medium_pct = excluded.medium_pct,
    hard_pct = excluded.hard_pct;

-- Seed 15 clearly marked FAKE SAMPLE Stage 1 Logic & Numeracy questions (5 per domain: 2 easy, 2 medium, 1 hard)
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
      v_qid := ('33333333-3333-3333-0001-' || lpad(v_seq::text, 12, '0'))::uuid;

      insert into public.questions (
        id, track, stage, domain, difficulty, type, stem, code_snippet, options, tolerance, active
      )
      values (
        v_qid,
        'ai',
        1,
        v_dom,
        v_diff,
        'mcq',
        format(
          '[FAKE SAMPLE S1 LOGIC #%s - NOT REAL CONTENT] (%s / %s) Sample logic & numeracy item %s for Stage 1 Part C. Which option is marked correct for testing?',
          v_seq, v_dom, v_diff, v_i
        ),
        null,
        jsonb_build_array(
          jsonb_build_object('id', 'A', 'text', 'Option A (Correct Stage 1 logic choice)'),
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
          stem = excluded.stem,
          options = excluded.options,
          active = excluded.active;

      insert into public.question_keys (question_id, correct, explanation)
      values (
        v_qid,
        'A',
        format('Fake sample answer key for Stage 1 logic item #%s', v_seq)
      )
      on conflict (question_id) do update
      set correct = excluded.correct,
          explanation = excluded.explanation;
    end loop;
  end loop;
end;
$$;

-- =============================================================================
-- 6. Milestone 4 (M4): Stage 3 AI Track Practical Project Rubrics & Sample Scenario
-- =============================================================================

-- 6.1 Stage 3 Rubric
insert into public.rubrics (id, stage, track, part, title, description, active)
values (
  '55555555-5555-5555-0003-000000000001',
  3,
  'ai',
  's3_project',
  'AI Track Stage 3 Practical Project Rubric',
  'Reviewer scoring criteria for Stage 3 Practical Project (A2, A3, B2, C, D)',
  true
)
on conflict (stage, track, part) do update
set title = excluded.title,
    description = excluded.description,
    active = excluded.active;

-- 6.2 Rubric Criteria (A2: 15 pts, A3: 10 pts, B2: 15 pts, C: 10 pts, D: 10 pts = 60 reviewer pts)
insert into public.rubric_criteria (id, rubric_id, slug, criterion, weight, scale_min, scale_max, anchors, sort_order)
values
  (
    '55555555-5555-5555-0003-000000000002',
    '55555555-5555-5555-0003-000000000001',
    'A2_methodology',
    'A2: Methodology, Validation & Leakage Prevention',
    15.0, 1, 4,
    '{"1": "Critical methodological flaws: visible target leakage, broken CV splits, or unaddressed label overlap.", "2": "Basic pipeline works but uses weak validation, arbitrary hyperparameters, or subtle temporal leakage.", "3": "Clean validation scheme, sensible preprocessing, properly handles class imbalance without leakage.", "4": "Rigorous cross-validation strategy, explicit leakage guards, justified modeling choices and solid feature engineering."}'::jsonb,
    1
  ),
  (
    '55555555-5555-5555-0003-000000000003',
    '55555555-5555-5555-0003-000000000001',
    'A3_data_cleaning',
    'A3: Data Cleaning & Preprocessing Rationale',
    10.0, 1, 4,
    '{"1": "No EDA or preprocessing documentation; drops columns arbitrarily or ignores corrupt records.", "2": "Basic data cleaning performed without explaining rationale or checking distribution shifts.", "3": "Systematic missing value and outlier treatment, documented imputation strategy, data checks present.", "4": "Deep exploratory analysis, justified domain transformations, thorough edge case handling and data health checks."}'::jsonb,
    2
  ),
  (
    '55555555-5555-5555-0003-000000000004',
    '55555555-5555-5555-0003-000000000001',
    'B2_answer_quality',
    'B2: RAG Answer Quality, Groundedness & Source Citations',
    15.0, 1, 4,
    '{"1": "Answers fabricate facts, contradict retrieved context, or fail to cite source documents entirely.", "2": "Answers partially cite context but include minor ungrounded claims or vague references.", "3": "Faithful to retrieved knowledge base, accurate direct answers with explicit, correct document citations.", "4": "Crisp, concise, fully grounded answers with exact section citations; transparently declines when source lacks evidence."}'::jsonb,
    3
  ),
  (
    '55555555-5555-5555-0003-000000000005',
    '55555555-5555-5555-0003-000000000001',
    'C_code_reproducibility',
    'C: Code Quality, Modularity & Reproducibility',
    10.0, 1, 4,
    '{"1": "Spaghetti code, hardcoded local paths, missing dependency files, or fails to execute.", "2": "Executes with manual tweaks; poorly structured or monolithic notebook without functions.", "3": "Clear virtual environment specs (requirements.txt), modular functions, reproducible seed setting.", "4": "Production-grade modular codebase with CLI/config flags, robust error handling, typing, and clear README."}'::jsonb,
    4
  ),
  (
    '55555555-5555-5555-0003-000000000006',
    '55555555-5555-5555-0003-000000000001',
    'D_writeup',
    'D: Technical Write-up & Analytical Maturity',
    10.0, 1, 4,
    '{"1": "Missing write-up or vague buzzwords without empirical backing; exaggerates metrics.", "2": "Superficial report describing actions without analyzing trade-offs, error patterns, or limitations.", "3": "Clear explanation of results, insightful error analysis, realistic operational trade-offs discussed.", "4": "Exemplary engineering communication: honest about failure modes, concrete latency/cost trade-offs, pragmatic production roadmap."}'::jsonb,
    5
  )
on conflict (id) do update
set criterion = excluded.criterion,
    weight = excluded.weight,
    anchors = excluded.anchors,
    sort_order = excluded.sort_order;

-- 6.3 Fake Sample Scenario for AI Track Stage 3 (Clearly marked for testing)
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
  '66666666-6666-6666-0003-000000000001',
  'ai',
  'v1.0',
  '[FAKE SAMPLE - NOT REAL CONTENT] Customer Support AI Operations (Ticketing & RAG)',
  'Build a multi-class priority classifier on customer support tickets and a RAG pipeline over internal knowledge base articles.',
  'ai-stage3-starter-kit.zip',
  '{"hidden_test_path": "ai-stage3-hidden-ground-truth.json", "practice_data_path": "ai-stage3-practice-ground-truth.json"}'::jsonb,
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

