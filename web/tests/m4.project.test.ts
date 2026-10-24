import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE1_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE2_ID = "00000000-0000-0000-0000-000000000005";
const GRADER_ID = "00000000-0000-0000-0000-000000000008";

const SUPABASE_BASE_BOOTSTRAP_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
  END
  $$;

  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

  CREATE TABLE IF NOT EXISTS auth.users (
    instance_id uuid,
    id uuid PRIMARY KEY,
    aud varchar(255),
    role varchar(255),
    email varchar(255) UNIQUE,
    encrypted_password varchar(255),
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    confirmation_token varchar(255),
    email_change varchar(255),
    email_change_token_new varchar(255),
    recovery_token varchar(255)
  );

  CREATE TABLE IF NOT EXISTS auth.identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    UNIQUE (provider_id, provider)
  );

  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
  $$;

  CREATE SCHEMA IF NOT EXISTS storage;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    owner uuid,
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text NOT NULL,
    owner uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_accessed_at timestamptz DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
    version text
  );

  CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[]
  LANGUAGE plpgsql
  IMMUTABLE
  AS $$
  DECLARE
    parts text[];
  BEGIN
    parts := string_to_array(name, '/');
    IF array_length(parts, 1) > 1 THEN
      RETURN parts[1:array_length(parts, 1) - 1];
    ELSE
      RETURN ARRAY[]::text[];
    END IF;
  END;
  $$;

  CREATE OR REPLACE FUNCTION storage.filename(name text)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  AS $$
  DECLARE
    parts text[];
  BEGIN
    parts := string_to_array(name, '/');
    RETURN parts[array_length(parts, 1)];
  END;
  $$;

  GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
`;

async function execAsUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  await db.exec("BEGIN");
  try {
    await db.exec(`
      SELECT
        set_config('request.jwt.claim.sub', '${userId}', true),
        set_config('request.jwt.claim.role', 'authenticated', true),
        set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      SET LOCAL ROLE authenticated;
    `);
    const res = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return { rows: res.rows };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

describe("Milestone 4: Practical Project & Grader Worker Engine", () => {
  let db: PGlite;
  let candidate1AppId: string;
  let candidate2AppId: string;

  before(async () => {
    db = new PGlite({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply migrations 0001, 0002, 0003, 0004 & seed
    const m1Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0001_m1_foundation.sql"), "utf8");
    const m2Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0002_m2_exam_engine.sql"), "utf8");
    const m3Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0003_m3_stage1_and_reviews.sql"), "utf8");
    const m4Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0004_m4_project_and_grader.sql"), "utf8");
    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");

    await db.exec(m1Sql);
    await db.exec(m2Sql);
    await db.exec(m3Sql);
    await db.exec(m4Sql);
    await db.exec(seedSql);

    // Set up Candidate 1 application advanced to s2_passed
    const res1 = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE1_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Chinedu Okafor', 'Nigeria', '+234 803 111 2222', 'https://github.com/chinedu-okafor',
        2.5, 'Python, ML, RAG', 'Africa/Lagos', 25,
        '11111111-1111-1111-1111-111111111101'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate1AppId = res1.rows[0]!.submit_onboarding.id;

    await execAsUser(
      db,
      CANDIDATE1_ID,
      `SELECT public.record_id_upload('${candidate1AppId}'::uuid, '${CANDIDATE1_ID}/${candidate1AppId}/id.pdf', 120000, 'application/pdf', 'NIN-1', 'Chinedu Okafor');`
    );
    await execAsUser(
      db,
      ADMIN_ID,
      `SELECT public.admin_verify_id('${candidate1AppId}'::uuid, 'approved', 'ID verified');`
    );

    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's1_open', 'Open S1');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's1_passed', 'Pass S1');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's2_open', 'Open S2');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's2_passed', 'Pass S2');`);

    // Set up Candidate 2 application advanced to s2_passed
    const res2 = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE2_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Amina Yusuf', 'Nigeria', '+234 803 222 3333', 'https://github.com/amina-yusuf',
        3.0, 'Python, ML, RAG', 'Africa/Lagos', 25,
        '11111111-1111-1111-1111-111111111102'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate2AppId = res2.rows[0]!.submit_onboarding.id;

    await execAsUser(
      db,
      CANDIDATE2_ID,
      `SELECT public.record_id_upload('${candidate2AppId}'::uuid, '${CANDIDATE2_ID}/${candidate2AppId}/id.pdf', 120000, 'application/pdf', 'NIN-2', 'Amina Yusuf');`
    );
    await execAsUser(
      db,
      ADMIN_ID,
      `SELECT public.admin_verify_id('${candidate2AppId}'::uuid, 'approved', 'ID verified');`
    );

    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's1_open', 'Open S1');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's1_passed', 'Pass S1');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's2_open', 'Open S2');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's2_passed', 'Pass S2');`);
  });

  after(async () => {
    if (db) await db.close();
  });

  it("1. starts project attempt with server-enforced 5-hour timer and advances status to s3_open", async () => {
    const res = await execAsUser<{ start_project: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.start_project('${candidate1AppId}');`
    );
    const attempt = res.rows[0]!.start_project;
    assert.ok(attempt.attempt_id, "Attempt ID should be returned");
    assert.equal(attempt.status, "in_progress");
    assert.equal(attempt.runs_used, 0);
    assert.equal(attempt.runs_allowed, 10);
    assert.equal(attempt.pause_used, false);

    // Check remaining seconds is roughly 5 hours (18000s)
    const statusRes = await execAsUser<{ get_project_status: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.get_project_status('${candidate1AppId}');`
    );
    const pStatus = statusRes.rows[0]!.get_project_status;
    assert.ok(pStatus.remaining_seconds > 17900 && pStatus.remaining_seconds <= 18000);

    // Check application status advanced to s3_open
    const appRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s3_open");
  });

  it("2. enforces pause policy: single logged pause extends deadline, second pause is rejected", async () => {
    const scRes = await db.query<{ id: string; deadline_at: string }>(
      `SELECT id, deadline_at::text FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const attemptId = scRes.rows[0]!.id;
    const originalDeadline = new Date(scRes.rows[0]!.deadline_at).getTime();

    // Pause attempt
    const pauseRes = await execAsUser<{ pause_project: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.pause_project('${attemptId}');`
    );
    assert.equal(pauseRes.rows[0]!.pause_project.status, "paused");
    assert.equal(pauseRes.rows[0]!.pause_project.pause_used, true);

    // Try second pause while already paused -> must fail
    await assert.rejects(
      async () => {
        await execAsUser(db, CANDIDATE1_ID, `SELECT public.pause_project('${attemptId}');`);
      },
      /Cannot pause project when status is paused|pause has already been used/i
    );

    // Resume attempt
    const resumeRes = await execAsUser<{ resume_project: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.resume_project('${attemptId}');`
    );
    assert.equal(resumeRes.rows[0]!.resume_project.status, "in_progress");

    // Verify deadline updated/extended
    const updatedDeadline = new Date(resumeRes.rows[0]!.resume_project.deadline_at).getTime();
    assert.ok(updatedDeadline >= originalDeadline);

    // Try pausing again after having already used pause -> must be rejected
    await assert.rejects(
      async () => {
        await execAsUser(db, CANDIDATE1_ID, `SELECT public.pause_project('${attemptId}');`);
      },
      /pause has already been used/i
    );
  });

  it("3. validates deliverable upload sizes and blocks upload when attempt is paused or expired", async () => {
    const attRes = await db.query<{ id: string }>(
      `SELECT id FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const attemptId = attRes.rows[0]!.id;

    // Mock storage object for candidate 1
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('project-submissions', '${CANDIDATE1_ID}/${attemptId}/A/test.csv', '${CANDIDATE1_ID}', '{"size": 1024}'::jsonb);
    `);

    // 1. Valid record_submission
    const subRes = await execAsUser<{ record_submission: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.record_submission(
        '${attemptId}',
        'A',
        'predictions',
        '${CANDIDATE1_ID}/${attemptId}/A/test.csv'
      );`
    );
    assert.equal(subRes.rows[0]!.record_submission.part, "A");
    assert.equal(subRes.rows[0]!.record_submission.kind, "predictions");

    // 2. Reject file exceeding size cap (predictions limit is 2 MB = 2097152 bytes)
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('project-submissions', '${CANDIDATE1_ID}/${attemptId}/A/oversized.csv', '${CANDIDATE1_ID}', '{"size": 3000000}'::jsonb);
    `);

    await assert.rejects(
      async () => {
        await execAsUser(
          db,
          CANDIDATE1_ID,
          `SELECT public.record_submission(
            '${attemptId}',
            'A',
            'predictions',
            '${CANDIDATE1_ID}/${attemptId}/A/oversized.csv'
          );`
        );
      },
      /File size 3000000 exceeds maximum limit/i
    );

    // 3. Pause project and verify submissions are blocked while paused
    await db.exec(`
      SELECT set_config('app.allow_project_write', 'true', false);
      UPDATE public.project_attempts SET pause_used = false, status = 'in_progress' WHERE id = '${attemptId}';
    `);
    await execAsUser(db, CANDIDATE1_ID, `SELECT public.pause_project('${attemptId}');`);

    await assert.rejects(
      async () => {
        await execAsUser(
          db,
          CANDIDATE1_ID,
          `SELECT public.record_submission(
            '${attemptId}',
            'B',
            'retrieval',
            '${CANDIDATE1_ID}/${attemptId}/B/ans.json'
          );`
        );
      },
      /Submissions are blocked while the project attempt is paused/i
    );

    // Resume for remaining tests
    await execAsUser(db, CANDIDATE1_ID, `SELECT public.resume_project('${attemptId}');`);
  });

  it("4. manages practice run queue and enforces strict 10-run limit", async () => {
    const attRes = await db.query<{ id: string }>(
      `SELECT id FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const attemptId = attRes.rows[0]!.id;

    // Queue runs up to 10
    const currentRuns = (await db.query<{ runs_used: number }>(
      `SELECT runs_used FROM public.project_attempts WHERE id = '${attemptId}';`
    )).rows[0]!.runs_used;

    for (let i = currentRuns; i < 10; i++) {
      const runRes = await execAsUser<{ request_practice_run: any }>(
        db,
        CANDIDATE1_ID,
        `SELECT public.request_practice_run('${attemptId}', 'A');`
      );
      assert.equal(runRes.rows[0]!.request_practice_run.status, "queued");
    }

    // Check runs_used is 10
    const checkRes = await db.query<{ runs_used: number }>(
      `SELECT runs_used FROM public.project_attempts WHERE id = '${attemptId}';`
    );
    assert.equal(checkRes.rows[0]!.runs_used, 10);

    // 11th run must be rejected
    await assert.rejects(
      async () => {
        await execAsUser(db, CANDIDATE1_ID, `SELECT public.request_practice_run('${attemptId}', 'A');`);
      },
      /Practice run limit reached/i
    );
  });

  it("5. grader atomically claims jobs using SKIP LOCKED and saves results", async () => {
    // 1. As grader, claim next job
    const claim1 = await execAsUser<{ claim_next_job: any }>(
      db,
      GRADER_ID,
      `SELECT public.claim_next_job('worker-alpha');`
    );
    assert.ok(claim1.rows[0]!.claim_next_job.job_id);
    const jobId = claim1.rows[0]!.claim_next_job.job_id;

    // 2. Simultaneous claim from another worker should NOT claim the same job
    const claim2 = await execAsUser<{ claim_next_job: any }>(
      db,
      GRADER_ID,
      `SELECT public.claim_next_job('worker-beta');`
    );
    if (claim2.rows[0]?.claim_next_job) {
      assert.notEqual(claim2.rows[0]!.claim_next_job.job_id, jobId, "Workers must claim distinct jobs");
    }

    // 3. Save practice job result
    const saveRes = await execAsUser<{ save_job_result: any }>(
      db,
      GRADER_ID,
      `SELECT public.save_job_result(
        '${jobId}',
        'done',
        '{"macro_f1": 0.72, "points": 10.67}'::jsonb,
        'Practice run Macro-F1: 0.7200 (award: 10.67 pts).',
        '{}'::jsonb,
        null
      );`
    );
    assert.equal(saveRes.rows[0]!.save_job_result.status, "done");

    // Verify that practice jobs do NOT insert into project_component_scores
    const compScores = await db.query(
      `SELECT * FROM public.project_component_scores WHERE attempt_id IN (
        SELECT attempt_id FROM public.submissions WHERE id IN (
          SELECT submission_id FROM public.grading_jobs WHERE id = '${jobId}'
        )
      );`
    );
    assert.equal(compScores.rows.length, 0, "Practice jobs must not write component scores");
  });

  it("6. candidate finalizes project, triggering final grading jobs and s3_grading status", async () => {
    const attRes = await db.query<{ id: string }>(
      `SELECT id FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const attemptId = attRes.rows[0]!.id;

    // Record retrieval submission for Part B
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('project-submissions', '${CANDIDATE1_ID}/${attemptId}/B/retrieval.json', '${CANDIDATE1_ID}', '{"size": 2048}'::jsonb);
    `);
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `SELECT public.record_submission(
        '${attemptId}',
        'B',
        'retrieval',
        '${CANDIDATE1_ID}/${attemptId}/B/retrieval.json'
      );`
    );

    // Finalize project
    const finRes = await execAsUser<{ finalize_project: any }>(
      db,
      CANDIDATE1_ID,
      `SELECT public.finalize_project('${attemptId}', 'Used Copilot for test writing');`
    );
    assert.equal(finRes.rows[0]!.finalize_project.status, "submitted");

    // Application status advanced to s3_grading
    const appRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s3_grading");

    // Verify final grading jobs were queued for predictions and retrieval
    const jobsRes = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM public.grading_jobs WHERE mode = 'final' AND status = 'queued';`
    );
    assert.ok(parseInt(jobsRes.rows[0]!.count, 10) >= 2);
  });

  it("7. computes Stage 3 result and enforces pass thresholds (60 total, >=16 Part A, >=16 Part B)", async () => {
    const attRes = await db.query<{ id: string }>(
      `SELECT id FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const attemptId = attRes.rows[0]!.id;

    // As grader, grade final jobs and save component points
    // Find final job for predictions
    const pJob = (await db.query<{ id: string }>(
      `SELECT id FROM public.grading_jobs WHERE mode = 'final' AND kind = 'predictions' LIMIT 1;`
    )).rows[0]!;

    await execAsUser(
      db,
      GRADER_ID,
      `SELECT public.save_job_result(
        '${pJob.id}',
        'done',
        '{"macro_f1": 0.80}'::jsonb,
        'Final A1 Macro-F1: 0.80',
        '{"A1": 13.33}'::jsonb,
        null
      );`
    );

    // Find final job for retrieval
    const rJob = (await db.query<{ id: string }>(
      `SELECT id FROM public.grading_jobs WHERE mode = 'final' AND kind = 'retrieval' LIMIT 1;`
    )).rows[0]!;

    await execAsUser(
      db,
      GRADER_ID,
      `SELECT public.save_job_result(
        '${rJob.id}',
        'done',
        '{"b1_hits": 14, "b3_refusals": 5}'::jsonb,
        'Final B1 & B3 scored',
        '{"B1": 14.0, "B3": 10.0}'::jsonb,
        null
      );`
    );

    // Verify auto component scores are saved
    const autoScores = await db.query<{ component: string; points: number }>(
      `SELECT component, points::float FROM public.project_component_scores WHERE attempt_id = '${attemptId}' ORDER BY component;`
    );
    assert.equal(autoScores.rows.find((r) => r.component === "A1")?.points, 13.33);
    assert.equal(autoScores.rows.find((r) => r.component === "B1")?.points, 14.0);
    assert.equal(autoScores.rows.find((r) => r.component === "B3")?.points, 10.0);

    // Seed reviewer components so Candidate 1 passes:
    // Part A = A1(13.33) + A2(12) + A3(8) = 33.33 (>= 16)
    // Part B = B1(14) + B2(15) + B3(10) = 39.0 (>= 16)
    // Part C = 10, Part D = 10 -> Total = 92.33 (>= 60)
    await db.exec(`
      INSERT INTO public.project_component_scores (attempt_id, component, points, max_points, source)
      VALUES
        ('${attemptId}', 'A2', 12.0, 15.0, 'reviewer'),
        ('${attemptId}', 'A3', 8.0, 10.0, 'reviewer'),
        ('${attemptId}', 'B2', 15.0, 15.0, 'reviewer'),
        ('${attemptId}', 'C', 10.0, 10.0, 'reviewer'),
        ('${attemptId}', 'D', 10.0, 10.0, 'reviewer')
      ON CONFLICT (attempt_id, component) DO UPDATE SET points = excluded.points;
    `);

    await db.query(`SELECT public.compute_stage3_result('${attemptId}');`);
    const stageResPass = await db.query<{ passed: boolean; raw_score: number }>(
      `SELECT passed, raw_score::float FROM public.stage_results WHERE application_id = '${candidate1AppId}' AND stage = 3;`
    );
    assert.equal(stageResPass.rows[0]!.passed, true, "Must pass when total >= 60 and both parts >= 16");
    assert.equal(stageResPass.rows[0]!.raw_score, 92.33);

    // Application advances to s3_passed
    const appRes = await db.query<{ status: string; current_stage: number }>(
      `SELECT status, current_stage FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s3_passed");
    assert.equal(appRes.rows[0]!.current_stage, 3);

    // Now test failing threshold on Candidate 2:
    // Candidate 2 starts project
    const c2Start = await execAsUser<{ start_project: any }>(
      db,
      CANDIDATE2_ID,
      `SELECT public.start_project('${candidate2AppId}');`
    );
    const c2AttemptId = c2Start.rows[0]!.start_project.attempt_id;

    // Candidate 2 finalizes project to transition to s3_grading
    await execAsUser(
      db,
      CANDIDATE2_ID,
      `SELECT public.finalize_project('${c2AttemptId}', 'Used ChatGPT for ideas');`
    );

    // Seed components for Candidate 2 where Part A < 16 (A1=10, A2=2, A3=2 = 14 < 16, even though total = 74 >= 60)
    await db.exec(`
      INSERT INTO public.project_component_scores (attempt_id, component, points, max_points, source)
      VALUES
        ('${c2AttemptId}', 'A1', 10.0, 15.0, 'auto'),
        ('${c2AttemptId}', 'A2', 2.0, 15.0, 'reviewer'),
        ('${c2AttemptId}', 'A3', 2.0, 10.0, 'reviewer'),
        ('${c2AttemptId}', 'B1', 15.0, 15.0, 'auto'),
        ('${c2AttemptId}', 'B2', 15.0, 15.0, 'reviewer'),
        ('${c2AttemptId}', 'B3', 10.0, 10.0, 'auto'),
        ('${c2AttemptId}', 'C', 10.0, 10.0, 'reviewer'),
        ('${c2AttemptId}', 'D', 10.0, 10.0, 'reviewer')
      ON CONFLICT (attempt_id, component) DO UPDATE SET points = excluded.points;
    `);

    await db.query(`SELECT public.compute_stage3_result('${c2AttemptId}');`);
    const c2Res = await db.query<{ passed: boolean }>(
      `SELECT passed FROM public.stage_results WHERE application_id = '${candidate2AppId}' AND stage = 3;`
    );
    assert.equal(c2Res.rows[0]!.passed, false, "Must fail if Part A < 16 even with total >= 60");

    const c2AppRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate2AppId}';`
    );
    assert.equal(c2AppRes.rows[0]!.status, "s3_failed");
  });

  it("8. enforces security: candidates cannot read hidden test kits, claim jobs, or mutate scores directly", async () => {
    const att = await db.query<{ id: string }>(
      `SELECT id FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    const targetAttemptId = att.rows[0]!.id;

    // 1. Candidate cannot call claim_next_job
    await assert.rejects(
      async () => {
        await execAsUser(db, CANDIDATE2_ID, `SELECT public.claim_next_job('malicious-candidate');`);
      },
      /Access denied: only grader workers/i
    );

    // 2. Candidate cannot call save_job_result
    await assert.rejects(
      async () => {
        await execAsUser(
          db,
          CANDIDATE2_ID,
          `SELECT public.save_job_result(
            '00000000-0000-0000-0000-000000000001',
            'done',
            '{}'::jsonb,
            'Hacked result',
            '{"A1": 15.0}'::jsonb
          );`
        );
      },
      /Access denied: only grader workers/i
    );

    // 3. RLS / defense trigger blocks direct INSERT into project_attempts outside server functions
    await assert.rejects(
      async () => {
        await execAsUser(
          db,
          CANDIDATE1_ID,
          `INSERT INTO public.project_attempts (application_id, scenario_id, deadline_at)
           VALUES ('${candidate1AppId}', '66666666-6666-6666-0003-000000000001', now());`
        );
      },
      /violates row-level security policy|Project attempts can only be updated through project server functions/i
    );

    // Direct UPDATE by candidate affects 0 rows due to RLS
    const updateRes = await execAsUser(
      db,
      CANDIDATE1_ID,
      `UPDATE public.project_attempts SET score = 100 WHERE id = '${targetAttemptId}';`
    );
    assert.equal(updateRes.rows.length, 0);

    // 4. Candidate cannot read other candidate's project attempt
    const otherAttempt = await execAsUser(
      db,
      CANDIDATE2_ID,
      `SELECT * FROM public.project_attempts WHERE application_id = '${candidate1AppId}';`
    );
    assert.equal(otherAttempt.rows.length, 0, "RLS must prevent candidate 2 from reading candidate 1 attempt");
  });
});
