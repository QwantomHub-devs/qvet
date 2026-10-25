import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { checkRateLimit } from "../src/lib/rate-limit.ts";
import { isValidImageOrPdfBytes, isValidVideoBytes } from "../src/lib/validation/magic-bytes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const REVIEWER1_UNILAG_ID = "00000000-0000-0000-0000-000000000002";
const REVIEWER2_ABU_ID = "00000000-0000-0000-0000-000000000003";
const CANDIDATE1_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE2_ID = "00000000-0000-0000-0000-000000000005";
const UNILAG_INST_ID = "11111111-1111-1111-1111-111111111101";
const ABU_INST_ID = "11111111-1111-1111-1111-111111111102";

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
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (provider_id, provider)
  );

  CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  CREATE OR REPLACE FUNCTION auth.role()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
  $$;

  CREATE SCHEMA IF NOT EXISTS storage;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text,
    owner uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_accessed_at timestamptz DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
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
    RETURN parts[1:array_length(parts, 1) - 1];
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

describe("Security Review: Penetration & Attack Simulation Test Suite", () => {
  let db: PGlite;
  let candidate1AppId: string;
  let candidate2AppId: string;
  let questionId: string;

  before(async () => {
    db = new PGlite({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply migrations 0001 through 0006 + seed
    for (const file of [
      "0001_m1_foundation.sql",
      "0002_m2_exam_engine.sql",
      "0003_m3_stage1_and_reviews.sql",
      "0004_m4_project_and_grader.sql",
      "0005_m5_stage4_results_credentials.sql",
      "0006_security_hardening.sql",
    ]) {
      const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations", file), "utf8");
      await db.exec(sql);
    }

    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Seed test users
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_ID}', 'admin@vetting.test'),
        ('${REVIEWER1_UNILAG_ID}', 'rev1@unilag.test'),
        ('${REVIEWER2_ABU_ID}', 'rev2@abu.test'),
        ('${CANDIDATE1_ID}', 'cand1@unilag.test'),
        ('${CANDIDATE2_ID}', 'cand2@abu.test')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (user_id, full_name, role, institution_id) VALUES
        ('${ADMIN_ID}', 'Root Admin', 'admin', NULL),
        ('${REVIEWER1_UNILAG_ID}', 'Prof. Lagos Reviewer', 'reviewer', '${UNILAG_INST_ID}'),
        ('${REVIEWER2_ABU_ID}', 'Dr. Zaria Reviewer', 'reviewer', '${ABU_INST_ID}'),
        ('${CANDIDATE1_ID}', 'Alice Candidate', 'candidate', '${UNILAG_INST_ID}'),
        ('${CANDIDATE2_ID}', 'Bob Candidate', 'candidate', '${ABU_INST_ID}')
      ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role, institution_id = EXCLUDED.institution_id;
    `);

    // Create applications for candidates via submit_onboarding
    const app1Res = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE1_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Alice Candidate', 'Nigeria', '+234 802 111 2222', 'https://github.com/alice-candidate',
        2.5, 'Python, ML', 'Africa/Lagos', 20,
        '${UNILAG_INST_ID}'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate1AppId = app1Res.rows[0]!.submit_onboarding.id;

    const app2Res = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE2_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Bob Candidate', 'Nigeria', '+234 803 222 3333', 'https://github.com/bob-candidate',
        3.0, 'Robotics, C++', 'Africa/Lagos', 25,
        '${ABU_INST_ID}'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate2AppId = app2Res.rows[0]!.submit_onboarding.id;

    const q = await db.query<{ id: string }>(`SELECT id FROM public.questions LIMIT 1`);
    questionId = q.rows[0]!.id;
  });

  after(async () => {
    if (db) await db.close();
  });

  describe("Vector 1 & 2: Information Disclosure & Question Key Protection", () => {
    it("ATTACK 1: Malicious candidate tries direct SELECT on question_keys", async () => {
      const res = await execAsUser(db, CANDIDATE1_ID, `SELECT * FROM public.question_keys`);
      assert.equal(res.rows.length, 0, "Candidate must receive 0 rows from question_keys");
    });

    it("ATTACK 2: Reviewer tries direct SELECT on question_keys", async () => {
      const res = await execAsUser(db, REVIEWER1_UNILAG_ID, `SELECT * FROM public.question_keys`);
      assert.equal(res.rows.length, 0, "Reviewer must receive 0 rows from question_keys");
    });

    it("ATTACK 3: Candidate tries nested subquery extraction of question_keys", async () => {
      const res = await execAsUser<{ leaked_answer: unknown }>(
        db,
        CANDIDATE1_ID,
        `SELECT (SELECT correct FROM public.question_keys WHERE question_id = $1) as leaked_answer`,
        [questionId]
      );
      assert.equal(res.rows[0]?.leaked_answer, null, "Nested subquery must return NULL due to RLS");
    });

    it("ATTACK 4: Candidate tries JOIN with question_keys", async () => {
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `SELECT q.stem, k.correct FROM public.questions q JOIN public.question_keys k ON k.question_id = q.id`
      );
      assert.equal(res.rows.length, 0, "JOIN with question_keys must yield 0 rows for candidate");
    });

    it("ATTACK 5: Candidate tries reading scenario-hidden bucket directly", async () => {
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `SELECT * FROM storage.objects WHERE bucket_id = 'scenario-hidden'`
      );
      assert.equal(res.rows.length, 0, "Candidate must never read objects from scenario-hidden bucket");
    });

    it("ATTACK 6: Candidate tries reading grading_jobs directly", async () => {
      const res = await execAsUser(db, CANDIDATE1_ID, `SELECT * FROM public.grading_jobs`);
      assert.equal(res.rows.length, 0, "Candidate must never read rows from grading_jobs");
    });
  });

  describe("Vector 1 & 3: Horizontal Privilege Escalation (Candidate A vs Candidate B)", () => {
    it("ATTACK 7: Candidate A tries reading Candidate B's application", async () => {
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `SELECT * FROM public.applications WHERE id = $1`,
        [candidate2AppId]
      );
      assert.equal(res.rows.length, 0, "Candidate A must not read Candidate B's application");
    });

    it("ATTACK 8: Candidate A tries reading Candidate B's ID documents", async () => {
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `SELECT * FROM public.id_documents WHERE application_id = $1`,
        [candidate2AppId]
      );
      assert.equal(res.rows.length, 0, "Candidate A must not read Candidate B's ID documents");
    });

    it("ATTACK 9: Candidate A tries reading Candidate B's written responses", async () => {
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `SELECT * FROM public.responses WHERE application_id = $1`,
        [candidate2AppId]
      );
      assert.equal(res.rows.length, 0, "Candidate A must not read Candidate B's responses");
    });

    it("ATTACK 10: Candidate A tries reading review_assignments or reviewer scores", async () => {
      const resAssign = await execAsUser(db, CANDIDATE1_ID, `SELECT * FROM public.review_assignments`);
      assert.equal(resAssign.rows.length, 0, "Candidate must not see review_assignments");

      const resScores = await execAsUser(db, CANDIDATE1_ID, `SELECT * FROM public.review_scores`);
      assert.equal(resScores.rows.length, 0, "Candidate must not see review_scores");
    });
  });

  describe("Vector 3: Tampering with Status, Scores, and Deadlines", () => {
    it("ATTACK 11: Candidate tries direct UPDATE to advance status to certified", async () => {
      // Due to RLS (lack of UPDATE policy on applications), candidate cannot update any application rows
      const res = await execAsUser(
        db,
        CANDIDATE1_ID,
        `UPDATE public.applications SET status = 'certified' WHERE id = $1 RETURNING *`,
        [candidate1AppId]
      );
      assert.equal(res.rows.length, 0, "Candidate must update 0 rows on applications due to lack of UPDATE policy");

      // Verify status in DB remains registered
      const check = await db.query<{ status: string }>(
        `SELECT status FROM public.applications WHERE id = $1`,
        [candidate1AppId]
      );
      assert.equal(check.rows[0]?.status, "registered", "Status must remain registered");
    });

    it("ATTACK 12: Candidate tries direct UPDATE to tamper with role in profiles", async () => {
      // Candidate has UPDATE policy on profiles, but trigger protect_profile_columns prevents privilege escalation
      await assert.rejects(
        async () => {
          await execAsUser(
            db,
            CANDIDATE1_ID,
            `UPDATE public.profiles SET role = 'admin' WHERE user_id = $1`,
            [CANDIDATE1_ID]
          );
        },
        /Insufficient privilege to change user role/,
        "Candidate cannot self-promote to admin"
      );
    });

    it("ATTACK 13: Candidate tries direct INSERT into stage_results", async () => {
      await assert.rejects(
        async () => {
          await execAsUser(
            db,
            CANDIDATE1_ID,
            `INSERT INTO public.stage_results (application_id, stage, raw_score, percent, passed) VALUES ($1, 2, 100, 100, true)`,
            [candidate1AppId]
          );
        },
        /Stage results can only be written by server scoring functions/,
        "Direct stage_results insert must be rejected by trigger"
      );
    });

    it("ATTACK 14: Candidate tries to directly invoke advance_status RPC", async () => {
      await assert.rejects(
        async () => {
          await execAsUser(
            db,
            CANDIDATE1_ID,
            `SELECT public.advance_status($1, 'certified', 'Hacked')`,
            [candidate1AppId]
          );
        },
        /Candidates and reviewers cannot call advance_status directly/,
        "Candidate direct call to advance_status must fail"
      );
    });

    it("ATTACK 15: Candidate tries to directly invoke admin_issue_credential RPC", async () => {
      await assert.rejects(
        async () => {
          await execAsUser(
            db,
            CANDIDATE1_ID,
            `SELECT public.admin_issue_credential($1)`,
            [candidate1AppId]
          );
        },
        /Access denied: only admins can issue credentials/,
        "Non-admin cannot issue credentials"
      );
    });

    it("ATTACK 16: Candidate tries to directly invoke claim_next_job (grader RPC)", async () => {
      await assert.rejects(
        async () => {
          await execAsUser(
            db,
            CANDIDATE1_ID,
            `SELECT public.claim_next_job('worker-1')`
          );
        },
        /Access denied: only grader workers can claim jobs/,
        "Candidate cannot claim grading jobs"
      );
    });
  });

  describe("Vector 1 & Blind Review Integrity (Rule 10)", () => {
    it("ATTACK 17: Reviewer cannot see other candidates' profile names or institutions", async () => {
      const res = await execAsUser(
        db,
        REVIEWER1_UNILAG_ID,
        `SELECT user_id, full_name, institution_id FROM public.profiles WHERE user_id = $1`,
        [CANDIDATE1_ID]
      );
      assert.equal(res.rows.length, 0, "Reviewer must not read profile details of candidate");
    });

    it("ATTACK 18: Public verification endpoint does not leak PII (user_id, application_id)", async () => {
      // Issue a credential as admin to test public verification output
      await db.exec(`
        -- Manually prepare application in s4_passed
        SELECT set_config('app.internal_caller', 'true', false);
        SELECT set_config('app.allow_status_update', 'true', false);
        SELECT set_config('app.allow_score_update', 'true', false);
        SELECT set_config('app.allow_stage_result_write', 'true', false);

        UPDATE public.applications SET status = 's4_passed', current_stage = 4 WHERE id = '${candidate1AppId}';
        INSERT INTO public.stage_results (application_id, stage, raw_score, percent, passed) VALUES
          ('${candidate1AppId}', 1, 80, 80, true),
          ('${candidate1AppId}', 2, 85, 85, true),
          ('${candidate1AppId}', 3, 90, 90, true),
          ('${candidate1AppId}', 4, 88, 88, true)
        ON CONFLICT (application_id, stage) DO NOTHING;
      `);

      const issued = await execAsUser<{ verify_code: string }>(
        db,
        ADMIN_ID,
        `SELECT (public.admin_issue_credential($1)).verify_code`,
        [candidate1AppId]
      );
      const code = issued.rows[0]!.verify_code;

      const verifyRes = await db.query<{ public_verify: Record<string, unknown> }>(
        `SELECT public.get_public_credential_verification($1) as public_verify`,
        [code]
      );
      const payload = verifyRes.rows[0]!.public_verify;

      assert.equal(payload.found, true);
      assert.equal(payload.full_name, "Alice Candidate");
      assert.equal(payload.track, "ai");
      assert.equal(payload.is_valid, true);

      // Verify NO internal keys leaked
      assert.equal(payload.user_id, undefined, "user_id must not leak in public verification");
      assert.equal(payload.application_id, undefined, "application_id must not leak");
      assert.equal(payload.credential_id, undefined, "internal credential_id must not leak");
      assert.equal(payload.national_id, undefined, "national ID must not leak");
      assert.equal(payload.overall_score, undefined, "overall score percentage must not leak in public view");
    });

    it("ATTACK 19 (SEC-01): Unassigned reviewer cannot query candidate project submissions", async () => {
      // Simulate an unassigned reviewer querying submissions table
      const res = await execAsUser(
        db,
        REVIEWER1_UNILAG_ID,
        `SELECT * FROM public.submissions`
      );
      assert.equal(res.rows.length, 0, "Unassigned reviewer must see 0 submissions");
    });
  });

  describe("Security Remediations Verification (SEC-03, SEC-04, SEC-05)", () => {
    it("SEC-04: Cap integrity events to 100 per exam attempt", async () => {
      // Start an exam attempt for candidate 1
      await db.exec(`
        SELECT set_config('app.internal_caller', 'true', false);
        UPDATE public.applications SET status = 's2_open', current_stage = 2 WHERE id = '${candidate1AppId}';
      `);

      const examRes = await execAsUser<{ start_exam: { attempt_id: string } }>(
        db,
        CANDIDATE1_ID,
        `SELECT public.start_exam('${candidate1AppId}', 2) as start_exam`
      );
      const attemptId = examRes.rows[0]!.start_exam.attempt_id;

      // Insert 105 integrity events
      for (let i = 0; i < 105; i++) {
        await execAsUser(
          db,
          CANDIDATE1_ID,
          `SELECT public.log_integrity_event($1, 'tab_hidden', '{"index": ${i}}'::jsonb)`,
          [attemptId]
        );
      }

      // Check total rows in database
      const countRes = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.integrity_events WHERE attempt_ref = $1`,
        [attemptId]
      );
      assert.equal(parseInt(countRes.rows[0]!.count, 10), 100, "Integrity events must be capped at 100");
    });

    it("SEC-03: Sliding-window rate limiter blocks brute force attempts", () => {
      const testKey = "test-rate-limit-attacker";
      for (let i = 0; i < 5; i++) {
        const check = checkRateLimit(testKey, 5, 60_000);
        assert.equal(check.allowed, true, `Attempt ${i + 1} within quota must be allowed`);
      }
      // 6th attempt exceeds maxAttempts=5
      const blocked = checkRateLimit(testKey, 5, 60_000);
      assert.equal(blocked.allowed, false, "6th attempt must be blocked by rate limiter");
      assert.equal(blocked.remaining, 0);
    });

    it("SEC-05: Binary magic-byte inspection rejects disguised files", () => {
      // Plain text disguised as a PNG
      const fakePng = new TextEncoder().encode("Hello, this is a disguised text file, not a real PNG");
      assert.equal(isValidImageOrPdfBytes(fakePng), false, "Disguised PNG must be rejected");

      // Valid PNG header: 0x89, 0x50, 0x4E, 0x47
      const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.equal(isValidImageOrPdfBytes(validPng), true, "Valid PNG header must be accepted");

      // Valid PDF header: %PDF
      const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
      assert.equal(isValidImageOrPdfBytes(validPdf), true, "Valid PDF header must be accepted");

      // Disguised video
      const fakeVideo = new TextEncoder().encode("Not a real video");
      assert.equal(isValidVideoBytes(fakeVideo), false, "Disguised video must be rejected");

      // Valid WebM header: 1A 45 DF A3
      const validWebm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
      assert.equal(isValidVideoBytes(validWebm), true, "Valid WebM header must be accepted");
    });
  });
});
