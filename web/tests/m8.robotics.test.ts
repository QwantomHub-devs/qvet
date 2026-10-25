import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const SUPABASE_BASE_BOOTSTRAP_SQL = `
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema extensions, auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmation_token varchar(255) default '',
  email_change varchar(255) default '',
  email_change_token_new varchar(255) default '',
  recovery_token varchar(255) default ''
);

create table if not exists auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default auth.uid(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant execute on all functions in schema auth, storage to anon, authenticated, service_role;
`;

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const GRADER_ID = "00000000-0000-0000-0000-000000000008";
const ROBOTICS_CANDIDATE_ID = "00000000-0000-0000-0000-000000000009";

async function execAsUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  try {
    await db.exec("BEGIN");
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
    await db.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: "authenticated" })]
    );
    await db.exec(`set local role authenticated`);
    const result = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return { rows: result.rows };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

describe("Milestone 8: Robotics Track End-to-End Test Suite", () => {
  let db: PGlite;
  let roboticsAppId: string;

  before(async () => {
    db = await PGlite.create({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply all migrations in order
    const migrationsDir = path.join(REPO_ROOT, "supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      const migrationSql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await db.exec(migrationSql);
    }

    // Apply seed data
    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Setup Robotics candidate user
    await db.exec(`
      INSERT INTO auth.users (id, email)
      VALUES ('${ROBOTICS_CANDIDATE_ID}', 'robotics-candidate@test.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (user_id, role, full_name)
      VALUES ('${ROBOTICS_CANDIDATE_ID}', 'candidate', 'Nikola Tesla Robotics')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Create an application in registered status, then advance to approved
    await db.query(`SELECT set_config('app.allow_application_insert', 'true', false);`);
    const appRes = await db.query<{ id: string }>(`
      INSERT INTO public.applications (user_id, track, status, current_stage, consent_at)
      VALUES ('${ROBOTICS_CANDIDATE_ID}', 'robotics', 'registered', 0, now())
      RETURNING id;
    `);
    roboticsAppId = appRes.rows[0]!.id;

    await db.exec(`
      SELECT set_config('app.internal_caller', 'true', false);
      SELECT public.advance_status('${roboticsAppId}', 'id_pending', 'ID submitted');
      SELECT public.advance_status('${roboticsAppId}', 'approved', 'Test setup approved');
    `);
  });

  after(async () => {
    await db.close();
  });

  it("1. draws Stage 1 Part A (written), Part B (video), and Part C (15 logic items) for Robotics track", async () => {
    // 1. Start Part A (Written)
    const partA = await execAsUser<{ start_stage1_part: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.start_stage1_part('${roboticsAppId}', 'text');`
    );
    const respA = partA.rows[0]!.start_stage1_part;
    assert.equal(respA.prompt.track, "robotics");
    assert.equal(respA.prompt.kind, "text");
    assert.ok(respA.response.id);

    // 2. Start Part B (Video)
    const partB = await execAsUser<{ start_stage1_part: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.start_stage1_part('${roboticsAppId}', 'video');`
    );
    const respB = partB.rows[0]!.start_stage1_part;
    assert.equal(respB.prompt.track, "robotics");
    assert.equal(respB.prompt.kind, "video");
    assert.ok(respB.response.id);

    // 3. Start Part C (15 Logic and Numeracy Questions)
    const partC = await execAsUser<{ start_exam: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.start_exam('${roboticsAppId}', 1);`
    );
    const examC = partC.rows[0]!.start_exam;
    assert.equal(examC.total_questions, 15);
    assert.equal(examC.current_index, 0);

    // Verify 5 logic, 5 probability, 5 charts drawn
    const drawnC = await db.query<{ domain: string; cnt: number }>(`
      SELECT q.domain, count(*)::int as cnt
      FROM public.exam_attempts ea,
           unnest(ea.question_ids) with ordinality as qid(id, ord)
      JOIN public.questions q ON q.id = qid.id
      WHERE ea.application_id = '${roboticsAppId}' AND ea.stage = 1
      GROUP BY q.domain
      ORDER BY q.domain;
    `);
    const countsC = Object.fromEntries(drawnC.rows.map((r) => [r.domain, r.cnt]));
    assert.equal(countsC.logic_patterns, 5);
    assert.equal(countsC.probability_numeracy, 5);
    assert.equal(countsC.charts_data, 5);
  });

  it("2. draws 40 Robotics Stage 2 technical questions matching exact blueprint domains & difficulty mix", async () => {
    // Advance status to s1_passed then s2_open to simulate Stage 1 completion
    await db.exec(`
      SELECT set_config('app.internal_caller', 'true', false);
      SELECT public.advance_status('${roboticsAppId}', 's1_passed', 'Stage 1 passed');
      SELECT public.advance_status('${roboticsAppId}', 's2_open', 'Stage 2 opened');
    `);

    const examRes = await execAsUser<{ start_exam: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.start_exam('${roboticsAppId}', 2);`
    );
    const exam = examRes.rows[0]!.start_exam;
    assert.equal(exam.total_questions, 40);

    // Check exact domain distribution:
    // tooling_math_ros (6), control_kinematics (8), perception_estimation (8),
    // navigation_planning (6), hardware_safety (6), deployment_lifecycle (6)
    const domainCounts = await db.query<{ domain: string; cnt: number }>(`
      SELECT q.domain, count(*)::int as cnt
      FROM public.exam_attempts ea,
           unnest(ea.question_ids) with ordinality as qid(id, ord)
      JOIN public.questions q ON q.id = qid.id
      WHERE ea.application_id = '${roboticsAppId}' AND ea.stage = 2
      GROUP BY q.domain
      ORDER BY q.domain;
    `);
    const counts = Object.fromEntries(domainCounts.rows.map((r) => [r.domain, r.cnt]));
    assert.equal(counts.tooling_math_ros, 6);
    assert.equal(counts.control_kinematics, 8);
    assert.equal(counts.perception_estimation, 8);
    assert.equal(counts.navigation_planning, 6);
    assert.equal(counts.hardware_safety, 6);
    assert.equal(counts.deployment_lifecycle, 6);

    // Check 40/40/20 difficulty mix across the 40 items: 16 easy, 16 medium, 8 hard
    const diffCounts = await db.query<{ difficulty: string; cnt: number }>(`
      SELECT q.difficulty, count(*)::int as cnt
      FROM public.exam_attempts ea,
           unnest(ea.question_ids) with ordinality as qid(id, ord)
      JOIN public.questions q ON q.id = qid.id
      WHERE ea.application_id = '${roboticsAppId}' AND ea.stage = 2
      GROUP BY q.difficulty
      ORDER BY q.difficulty;
    `);
    const diffs = Object.fromEntries(diffCounts.rows.map((r) => [r.difficulty, r.cnt]));
    assert.equal(diffs.easy, 16);
    assert.equal(diffs.medium, 16);
    assert.equal(diffs.hard, 8);
  });

  it("3. submits answers to Robotics Stage 2 technical exam and advances status to s2_passed", async () => {
    const attempt = await db.query<{ id: string; question_ids: string[] }>(`
      SELECT id, question_ids FROM public.exam_attempts
      WHERE application_id = '${roboticsAppId}' AND stage = 2;
    `);
    const attemptId = attempt.rows[0]!.id;
    const qids = attempt.rows[0]!.question_ids;

    // Fetch keys for the drawn questions
    const keys = await db.query<{ question_id: string; correct: string }>(`
      SELECT question_id, correct FROM public.question_keys WHERE question_id = ANY($1::uuid[]);
    `, [qids]);
    const keyMap = new Map(keys.rows.map((r) => [r.question_id, r.correct]));

    // Answer 32 out of 40 correctly (80% >= 60% pass mark)
    for (let i = 0; i < 40; i++) {
      const qid = qids[i]!;
      const correctVal = keyMap.get(qid)!;
      const answerVal = i < 32 ? correctVal : "X";

      await execAsUser(
        db,
        ROBOTICS_CANDIDATE_ID,
        `SELECT public.submit_answer('${attemptId}', '${qid}', '${answerVal}');`
      );
    }

    const appStatus = await db.query<{ status: string }>(`
      SELECT status FROM public.applications WHERE id = '${roboticsAppId}';
    `);
    assert.equal(appStatus.rows[0]!.status, "s2_passed");
  });

  it("4. starts Robotics Stage 3 project and manages practice run queue with robot_sim job kind", async () => {
    // 1. Start Stage 3 project
    const startProj = await execAsUser<{ start_project: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.start_project('${roboticsAppId}');`
    );
    const proj = startProj.rows[0]!.start_project;
    assert.ok(proj.attempt_id);
    assert.equal(proj.status, "in_progress");
    assert.match(proj.scenario_title, /Autonomous Warehouse Delivery Robot/);
    const attemptId = proj.attempt_id;

    // 2. Candidate uploads Part A controller deliverable
    const filePathA = `${ROBOTICS_CANDIDATE_ID}/${attemptId}/A/controller.py`;
    const subA = await execAsUser<{ record_submission: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.record_submission('${attemptId}', 'A', 'code', '${filePathA}', 'None');`
    );
    assert.ok(subA.rows[0]!.record_submission.id);

    // 3. Request practice run -> must queue 'robot_sim' kind for Robotics track
    const practiceRun = await execAsUser<{ request_practice_run: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.request_practice_run('${attemptId}', 'A');`
    );
    const runInfo = practiceRun.rows[0]!.request_practice_run;
    assert.equal(runInfo.kind, "robot_sim");
    assert.equal(runInfo.mode, "practice");
    assert.equal(runInfo.runs_used, 1);

    // 4. Grader worker claims next job
    const claimRes = await execAsUser<{ claim_next_job: any }>(
      db,
      GRADER_ID,
      `SELECT public.claim_next_job('worker-robotics-1');`
    );
    const claimed = claimRes.rows[0]!.claim_next_job;
    assert.equal(claimed.job_id, runInfo.job_id);
    assert.equal(claimed.kind, "robot_sim");

    // 5. Save practice results
    await execAsUser(
      db,
      GRADER_ID,
      `SELECT public.save_job_result('${claimed.job_id}', 'done', '{"points": 65.0}'::jsonb, 'Multi-seed median simulation passed.');`
    );
  });

  it("5. finalizes Robotics project, grades multi-seed components, and advances to s3_passed", async () => {
    const att = await db.query<{ id: string }>(`
      SELECT id FROM public.project_attempts WHERE application_id = '${roboticsAppId}';
    `);
    const attemptId = att.rows[0]!.id;

    // Candidate uploads Part B (perception), Part C (architecture & safety review), writeup
    const filePathB = `${ROBOTICS_CANDIDATE_ID}/${attemptId}/B/perception.py`;
    const filePathC = `${ROBOTICS_CANDIDATE_ID}/${attemptId}/C/design.md`;
    const filePathW = `${ROBOTICS_CANDIDATE_ID}/${attemptId}/writeup/writeup.md`;

    await execAsUser(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.record_submission('${attemptId}', 'B', 'code', '${filePathB}', 'None');`
    );
    await execAsUser(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.record_submission('${attemptId}', 'C', 'writeup', '${filePathC}', 'None');`
    );
    await execAsUser(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.record_submission('${attemptId}', 'writeup', 'writeup', '${filePathW}', 'None');`
    );

    // Finalize project attempt
    const finRes = await execAsUser<{ finalize_project: any }>(
      db,
      ROBOTICS_CANDIDATE_ID,
      `SELECT public.finalize_project('${attemptId}', 'Robotics candidate submitted all deliverables');`
    );
    assert.equal(finRes.rows[0]!.finalize_project.status, "submitted");

    // Verify application advanced to s3_grading
    const appS3 = await db.query<{ status: string }>(`
      SELECT status FROM public.applications WHERE id = '${roboticsAppId}';
    `);
    assert.equal(appS3.rows[0]!.status, "s3_grading");

    // Claim and grade Part A final job
    const claimA = await execAsUser<{ claim_next_job: any }>(
      db,
      GRADER_ID,
      `SELECT public.claim_next_job('worker-robotics-final');`
    );
    const finalJobA = claimA.rows[0]!.claim_next_job;
    assert.ok(finalJobA.job_id);
    assert.equal(finalJobA.kind, "robot_sim");
    assert.equal(finalJobA.mode, "final");

    // Grader records automatic multi-seed median scores:
    // A1 (20/20), A2 (15/15), A3 (10/10) = 45 Part A points
    // B1 (10/10), B2 (10/10) = 20 Part B points
    await execAsUser(
      db,
      GRADER_ID,
      `SELECT public.save_job_result(
        '${finalJobA.job_id}',
        'done',
        '{"passed": true}'::jsonb,
        'Multi-seed median simulation complete',
        '{"A1": 20.0, "A2": 15.0, "A3": 10.0, "B1": 10.0, "B2": 10.0}'::jsonb
      );`
    );

    // Reviewer records rubric scores for C (15), D (10), E (10)
    await db.exec(`
      SELECT set_config('app.allow_project_write', 'true', false);
      INSERT INTO public.project_component_scores (attempt_id, component, points, max_points, source)
      VALUES
        ('${attemptId}', 'C', 13.5, 15.0, 'reviewer'),
        ('${attemptId}', 'D', 9.5, 10.0, 'reviewer'),
        ('${attemptId}', 'E', 9.0, 10.0, 'reviewer');
    `);

    // Compute Stage 3 result
    await db.query(`SELECT public.compute_stage3_result('${attemptId}');`);

    const finalApp = await db.query<{ status: string }>(`
      SELECT status FROM public.applications WHERE id = '${roboticsAppId}';
    `);
    assert.equal(finalApp.rows[0]!.status, "s3_passed");

    const stage3Res = await db.query<{ raw_score: number; percent: number; passed: boolean }>(`
      SELECT raw_score, percent, passed FROM public.stage_results
      WHERE application_id = '${roboticsAppId}' AND stage = 3;
    `);
    assert.equal(stage3Res.rows[0]!.passed, true);
    // Total = 20 + 15 + 10 + 10 + 10 + 13.5 + 9.5 + 9.0 = 97.0
    assert.equal(Number(stage3Res.rows[0]!.percent), 97.0);
  });
});
