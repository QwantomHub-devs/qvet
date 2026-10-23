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

