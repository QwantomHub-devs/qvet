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
    {"id": "00000000-0000-0000-0000-000000000005", "email": "candidate2@vetting.local", "role": "candidate", "full_name": "Amina Yusuf", "inst_id": "11111111-1111-1111-1111-111111111102"}
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
