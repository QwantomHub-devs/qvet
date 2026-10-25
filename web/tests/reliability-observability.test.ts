import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  getCircuitBreakerStatus,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuitBreaker,
} from "../src/lib/qfellows/circuit-breaker.ts";
import { flushOutboundWebhooks } from "../src/lib/qfellows/webhook-dispatcher.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ID = "00000000-0000-0000-0000-000000000c01";

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

describe("Platform Reliability, DLQ, Circuit Breakers & Observability", () => {
  let db: PGlite;
  let testAppId: string;
  let testAttemptId: string;
  let testDeliverableId: string;

  before(async () => {
    db = new PGlite({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply all numbered migrations 0001 through 0008 + seed
    for (const file of [
      "0001_m1_foundation.sql",
      "0002_m2_exam_engine.sql",
      "0003_m3_stage1_and_reviews.sql",
      "0004_m4_project_and_grader.sql",
      "0005_m5_stage4_results_credentials.sql",
      "0006_security_hardening.sql",
      "0007_qfellows_integration.sql",
      "0008_reliability_and_dlq.sql",
    ]) {
      const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations", file), "utf8");
      await db.exec(sql);
    }

    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Seed test users
    await db.exec(`
      SELECT set_config('app.allow_role_update', 'true', false);

      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_ID}', 'admin@vetting.test'),
        ('${CANDIDATE_ID}', 'candidate.rel@example.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (user_id, full_name, role) VALUES
        ('${ADMIN_ID}', 'System Administrator', 'admin'),
        ('${CANDIDATE_ID}', 'Adaeze Okafor', 'candidate')
      ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role;

      SELECT set_config('app.allow_role_update', 'false', false);

      -- Setup candidate application in s3_open for testing
      INSERT INTO public.applications (
        id, user_id, track, status, current_stage, consent_at
      ) VALUES (
        '88888888-8888-8888-8888-888888888888',
        '${CANDIDATE_ID}',
        'ai',
        'registered',
        0,
        now()
      )
      ON CONFLICT (id) DO NOTHING;

      SELECT set_config('app.internal_caller', 'true', false);
      SELECT set_config('app.allow_status_update', 'true', false);
      SELECT set_config('app.allow_project_write', 'true', false);
      SELECT set_config('app.allow_submission_write', 'true', false);
      UPDATE public.applications SET status = 's3_open', current_stage = 3 WHERE id = '88888888-8888-8888-8888-888888888888';

      -- Seed project attempt and submission
      INSERT INTO public.project_attempts (
        id, application_id, scenario_id, status, started_at, deadline_at, runs_allowed, runs_used
      ) VALUES (
        '77777777-7777-7777-7777-777777777777',
        '88888888-8888-8888-8888-888888888888',
        '66666666-6666-6666-0003-000000000001',
        'in_progress',
        now(),
        now() + interval '5 hours',
        10,
        0
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.submissions (
        id, attempt_id, part, kind, file_path, file_size_bytes
      ) VALUES (
        '66666666-6666-6666-6666-666666666666',
        '77777777-7777-7777-7777-777777777777',
        'A',
        'predictions',
        '${CANDIDATE_ID}/predictions.csv',
        1024
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    testAppId = "88888888-8888-8888-8888-888888888888";
    testAttemptId = "77777777-7777-7777-7777-777777777777";
    testDeliverableId = "66666666-6666-6666-6666-666666666666";
  });

  after(async () => {
    if (db) await db.close();
  });

  describe("1. Circuit Breaker State Machine & Trip Defense", () => {
    it("manages state transitions: CLOSED -> OPEN after 5 failures", async () => {
      // Mock supabase client interfacing with db
      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const res = await db.query<{ value: unknown }>(
                  "SELECT value FROM public.settings WHERE key = 'circuit_breaker_qfellows'"
                );
                return { data: res.rows[0] ?? null };
              },
            }),
          }),
          update: (val: Record<string, unknown>) => ({
            eq: async () => {
              await db.query(
                "UPDATE public.settings SET value = $1::jsonb, updated_at = now() WHERE key = 'circuit_breaker_qfellows'",
                [JSON.stringify(val.value)]
              );
              return { data: null };
            },
          }),
        }),
      };

      // Initial state is CLOSED
      const initial = await getCircuitBreakerStatus(mockSupabase as any);
      assert.equal(initial.state, "CLOSED");
      assert.equal(initial.canAttempt, true);

      // Record 4 failures
      for (let i = 1; i <= 4; i++) {
        const cfg = await recordCircuitFailure(`Connection error ${i}`, mockSupabase as any);
        assert.equal(cfg.state, "CLOSED");
        assert.equal(cfg.failure_count, i);
      }

      // 5th failure trips to OPEN
      const tripped = await recordCircuitFailure("Connection error 5", mockSupabase as any);
      assert.equal(tripped.state, "OPEN");
      assert.equal(tripped.failure_count, 5);

      // Subsequent check returns canAttempt: false
      const checked = await getCircuitBreakerStatus(mockSupabase as any);
      assert.equal(checked.state, "OPEN");
      assert.equal(checked.canAttempt, false);

      // Reset circuit breaker
      const reset = await resetCircuitBreaker(mockSupabase as any);
      assert.equal(reset.state, "CLOSED");
      assert.equal(reset.failure_count, 0);

      const afterReset = await getCircuitBreakerStatus(mockSupabase as any);
      assert.equal(afterReset.state, "CLOSED");
      assert.equal(afterReset.canAttempt, true);
    });
  });

  describe("2. Idempotent Practice Runs with Client Request ID", () => {
    it("prevents double-counting runs when client retries with the same client_request_id", async () => {
      const clientReqId = "req_practice_click_unique_99";

      // First call
      const res1 = await execAsUser<{ request_practice_run: Record<string, unknown> }>(
        db,
        CANDIDATE_ID,
        `SELECT public.request_practice_run('${testAttemptId}', 'A', '${clientReqId}')`
      );

      const run1 = res1.rows[0]!.request_practice_run;
      assert.equal(run1.status, "queued");
      assert.equal(run1.runs_used, 1);
      assert.equal(run1.idempotent, false);

      // Retry with identical client_request_id
      const res2 = await execAsUser<{ request_practice_run: Record<string, unknown> }>(
        db,
        CANDIDATE_ID,
        `SELECT public.request_practice_run('${testAttemptId}', 'A', '${clientReqId}')`
      );

      const run2 = res2.rows[0]!.request_practice_run;
      assert.equal(run2.job_id, run1.job_id, "Must return the same job ID");
      assert.equal(run2.runs_used, 1, "Must NOT increment runs_used on retry");
      assert.equal(run2.idempotent, true, "Must flag as idempotent response");
    });
  });

  describe("3. Grader Worker Stalled Recovery & DLQ Isolation", () => {
    it("moves jobs that exceeded 3 attempts to dead_letter rather than looping indefinitely", async () => {
      // Seed a job that failed 3 times and stalled
      const failedJobId = "55555555-5555-5555-5555-555555555555";
      await db.exec(`
        SELECT set_config('app.allow_grading_job_write', 'true', false);
        INSERT INTO public.grading_jobs (
          id, submission_id, kind, mode, status, attempts, started_at
        ) VALUES (
          '${failedJobId}',
          '${testDeliverableId}',
          'predictions',
          'practice',
          'running',
          3,
          now() - interval '10 minutes'
        );
      `);

      // Grader runs requeue_stuck_jobs
      const res = await execAsUser<{ requeue_stuck_jobs: Record<string, unknown> }>(
        db,
        ADMIN_ID,
        `SELECT public.requeue_stuck_jobs(5, 3)`
      );

      const summary = res.rows[0]!.requeue_stuck_jobs;
      assert.equal(summary.dead_lettered, 1);

      // Verify the job is in dead_letter
      const jobCheck = await db.query<{ status: string; error: string }>(
        `SELECT status, error FROM public.grading_jobs WHERE id = '${failedJobId}'`
      );
      assert.equal(jobCheck.rows[0]!.status, "dead_letter");
      assert.match(jobCheck.rows[0]!.error, /exceeded max attempts/i);
    });

    it("allows admin to re-drive dead-lettered grading jobs back to queued", async () => {
      const failedJobId = "55555555-5555-5555-5555-555555555555";
      const redrive = await execAsUser<{ admin_redrive_grading_jobs: number }>(
        db,
        ADMIN_ID,
        `SELECT public.admin_redrive_grading_jobs(ARRAY['${failedJobId}']::uuid[])`
      );

      assert.equal(redrive.rows[0]!.admin_redrive_grading_jobs, 1);

      const jobCheck = await db.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM public.grading_jobs WHERE id = '${failedJobId}'`
      );
      assert.equal(jobCheck.rows[0]!.status, "queued");
      assert.equal(jobCheck.rows[0]!.attempts, 0);
    });
  });

  describe("4. Outbound Webhook DLQ Re-drive", () => {
    it("allows admin to re-drive dead-lettered webhooks back to pending", async () => {
      const deadWebhookId = "44444444-4444-4444-4444-444444444444";
      await db.exec(`
        INSERT INTO public.outbound_webhooks (
          id, application_id, event, idempotency_key, payload, status, attempts, last_error
        ) VALUES (
          '${deadWebhookId}',
          '${testAppId}',
          'stage.passed',
          'evt_test_dlq_redrive',
          '{"event": "stage.passed"}'::jsonb,
          'dead_letter',
          5,
          'HTTP 400 Bad Request'
        );
      `);

      const res = await execAsUser<{ admin_redrive_webhooks: number }>(
        db,
        ADMIN_ID,
        `SELECT public.admin_redrive_webhooks(ARRAY['${deadWebhookId}']::uuid[])`
      );

      assert.equal(res.rows[0]!.admin_redrive_webhooks, 1);

      const check = await db.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM public.outbound_webhooks WHERE id = '${deadWebhookId}'`
      );
      assert.equal(check.rows[0]!.status, "pending");
      assert.equal(check.rows[0]!.attempts, 0);
    });
  });

  describe("5. Platform-Wide Telemetry Analytics RPC", () => {
    it("returns comprehensive aggregate telemetry data and blocks non-admins", async () => {
      // Non-admin call is rejected
      await assert.rejects(
        async () => {
          await execAsUser(db, CANDIDATE_ID, `SELECT public.get_platform_telemetry()`);
        },
        /Access denied/i
      );

      // Admin call succeeds
      const res = await execAsUser<{ get_platform_telemetry: Record<string, unknown> }>(
        db,
        ADMIN_ID,
        `SELECT public.get_platform_telemetry()`
      );

      const tel = res.rows[0]!.get_platform_telemetry;
      assert.ok(tel.funnel !== undefined);
      assert.ok(tel.tracks !== undefined);
      assert.ok(tel.tiers !== undefined);
      assert.ok(tel.averages !== undefined);
      assert.ok(tel.webhooks !== undefined);
      assert.ok(tel.grader !== undefined);
      assert.ok(tel.circuit_breaker !== undefined);

      const funnel = tel.funnel as Record<string, unknown>;
      assert.ok(Number(funnel.total_registered) >= 1);
    });
  });
});
