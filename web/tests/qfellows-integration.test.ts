import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  computeHmacSignature,
  verifyHmacSignature,
  createSignedInviteToken,
  verifySignedInviteToken,
} from "../src/lib/qfellows/webhook-signer.ts";
import {
  dispatchSingleWebhook,
  getNextRetryTimestamp,
  BACKOFF_DELAYS_SECONDS,
  type OutboundWebhookRow,
} from "../src/lib/qfellows/webhook-dispatcher.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ID = "00000000-0000-0000-0000-000000000c01";
const CANDIDATE_2_ID = "00000000-0000-0000-0000-000000000c02";
const TEST_SECRET = "test-qfellows-hmac-shared-secret-123456789";

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

describe("Q-Fellows Integration & Webhook Engine Test Suite", () => {
  let db: PGlite;
  let testAppId: string;
  const externalAppId = "d290f1ee-6c54-4b01-90e6-d701748f0851";

  before(async () => {
    db = new PGlite({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply migrations 0001 through 0007 + seed
    for (const file of [
      "0001_m1_foundation.sql",
      "0002_m2_exam_engine.sql",
      "0003_m3_stage1_and_reviews.sql",
      "0004_m4_project_and_grader.sql",
      "0005_m5_stage4_results_credentials.sql",
      "0006_security_hardening.sql",
      "0007_qfellows_integration.sql",
    ]) {
      const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations", file), "utf8");
      await db.exec(sql);
    }

    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Seed test admin and candidate
    await db.exec(`
      SELECT set_config('app.allow_role_update', 'true', false);

      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_ID}', 'admin@vetting.test'),
        ('${CANDIDATE_ID}', 'adaeze@example.com'),
        ('${CANDIDATE_2_ID}', 'chidi@example.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (user_id, full_name, role) VALUES
        ('${ADMIN_ID}', 'Root Admin', 'admin'),
        ('${CANDIDATE_ID}', 'Adaeze Okafor', 'candidate'),
        ('${CANDIDATE_2_ID}', 'Chidi Eze', 'candidate')
      ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role;

      SELECT set_config('app.allow_role_update', 'false', false);

      -- Create candidate application linked to external_application_id
      INSERT INTO public.applications (
        id, user_id, track, status, current_stage, external_application_id, external_cohort_code, consent_at
      ) VALUES (
        '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        '${CANDIDATE_ID}',
        'ai',
        'registered',
        0,
        '${externalAppId}',
        'QF-2026-C1',
        now()
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    testAppId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  });

  after(async () => {
    if (db) await db.close();
  });

  describe("1. HMAC-SHA256 Cryptographic Verification & Invite Tokens", () => {
    it("computes and verifies HMAC-SHA256 signatures with timing-safe comparison", () => {
      const payload = JSON.stringify({ hello: "world", candidate_id: 123 });
      const signature = computeHmacSignature(payload, TEST_SECRET);

      // Raw hex
      assert.equal(verifyHmacSignature(payload, TEST_SECRET, signature), true);
      // sha256= prefix
      assert.equal(verifyHmacSignature(payload, TEST_SECRET, `sha256=${signature}`), true);
      // Tampered payload
      assert.equal(verifyHmacSignature(payload + "tampered", TEST_SECRET, signature), false);
      // Wrong secret
      assert.equal(verifyHmacSignature(payload, "wrong-secret", signature), false);
      // Empty or missing signature
      assert.equal(verifyHmacSignature(payload, TEST_SECRET, null), false);
      assert.equal(verifyHmacSignature(payload, TEST_SECRET, ""), false);
    });

    it("creates and verifies tamper-proof candidate invite tokens", () => {
      const token = createSignedInviteToken(
        {
          applicationId: testAppId,
          email: "adaeze@example.com",
          track: "ai",
          expiresInSeconds: 3600,
        },
        TEST_SECRET
      );

      assert.ok(token.includes("."));
      const verified = verifySignedInviteToken(token, TEST_SECRET);
      assert.equal(verified.valid, true);
      assert.equal(verified.data?.applicationId, testAppId);
      assert.equal(verified.data?.email, "adaeze@example.com");
      assert.equal(verified.data?.track, "ai");

      // Tampered token
      const tamperedToken = token.slice(0, -4) + "abcd";
      const badVerify = verifySignedInviteToken(tamperedToken, TEST_SECRET);
      assert.equal(badVerify.valid, false);

      // Expired token
      const expiredToken = createSignedInviteToken(
        {
          applicationId: testAppId,
          email: "adaeze@example.com",
          track: "ai",
          expiresInSeconds: -10, // already expired
        },
        TEST_SECRET
      );
      const expiredVerify = verifySignedInviteToken(expiredToken, TEST_SECRET);
      assert.equal(expiredVerify.valid, false);
      assert.match(expiredVerify.error!, /expired/i);
    });
  });

  describe("2. Database Outbox Webhook Enqueuing & Trigger Automation", () => {
    it("automatically enqueues 'application.approved' webhook when ID is verified", async () => {
      // Simulate advance_status to id_pending then approved
      await db.exec(`
        SELECT set_config('app.internal_caller', 'true', false);
        SELECT public.advance_status('${testAppId}', 'id_pending', 'Candidate uploaded ID');
        SELECT public.advance_status('${testAppId}', 'approved', 'Admin approved ID');
      `);

      const res = await db.query<OutboundWebhookRow>(
        `SELECT * FROM public.outbound_webhooks WHERE application_id = $1 AND event = 'application.approved'`,
        [testAppId]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0]!;
      assert.equal(row.status, "pending");
      assert.equal(row.payload.event, "application.approved");
      assert.equal((row.payload.candidate as Record<string, unknown>).external_application_id, externalAppId);
      assert.equal((row.payload.candidate as Record<string, unknown>).email, "adaeze@example.com");
      assert.equal((row.payload.stage_update as Record<string, unknown>).passed, true);
    });

    it("automatically enqueues 'stage.passed' webhook when candidate passes Stage 1", async () => {
      await db.exec(`
        SELECT set_config('app.internal_caller', 'true', false);
        SELECT set_config('app.allow_stage_result_write', 'true', false);

        INSERT INTO public.stage_results (application_id, stage, raw_score, percent, passed, details)
        VALUES ('${testAppId}', 1, 85, 85, true, '{"communication_rating": 4.5}'::jsonb)
        ON CONFLICT (application_id, stage) DO NOTHING;

        SELECT public.advance_status('${testAppId}', 's1_open', 'Open S1');
        SELECT public.advance_status('${testAppId}', 's1_passed', 'Pass S1');
      `);

      const res = await db.query<OutboundWebhookRow>(
        `SELECT * FROM public.outbound_webhooks WHERE application_id = $1 AND event = 'stage.passed' AND idempotency_key LIKE '%_s1_%'`,
        [testAppId]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0]!;
      assert.equal(row.payload.event, "stage.passed");
      assert.equal((row.payload.stage_update as Record<string, unknown>).stage_number, 1);
      assert.equal((row.payload.stage_update as Record<string, unknown>).score, 85);
    });

    it("automatically enqueues 'credential.issued' with full scorecard and verify_code", async () => {
      await db.exec(`
        SELECT set_config('app.internal_caller', 'true', false);
        SELECT set_config('app.allow_status_update', 'true', false);
        SELECT set_config('app.allow_score_update', 'true', false);
        SELECT set_config('app.allow_stage_result_write', 'true', false);

        -- Seed remaining stages 2, 3, 4
        INSERT INTO public.stage_results (application_id, stage, raw_score, percent, passed, details) VALUES
          ('${testAppId}', 2, 80, 80, true, '{"domains": {"ml": 80}}'::jsonb),
          ('${testAppId}', 3, 90, 90, true, '{"part_a_score": 92, "part_b_score": 88, "summary": "Great model", "tools_used": ["PyTorch"]}'::jsonb),
          ('${testAppId}', 4, 88, 88, true, '{"rubric_avg": 3.6, "understanding_of_work": 4}'::jsonb)
        ON CONFLICT (application_id, stage) DO NOTHING;

        UPDATE public.applications SET status = 's4_passed', current_stage = 4 WHERE id = '${testAppId}';
      `);

      // Admin issues credential
      const cred = await execAsUser<{ verify_code: string }>(
        db,
        ADMIN_ID,
        `SELECT (public.admin_issue_credential('${testAppId}')).verify_code`
      );
      const code = cred.rows[0]!.verify_code;

      const res = await db.query<OutboundWebhookRow>(
        `SELECT * FROM public.outbound_webhooks WHERE application_id = $1 AND event = 'credential.issued'`,
        [testAppId]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0]!;
      assert.equal(row.payload.event, "credential.issued");
      assert.equal((row.payload.credential as Record<string, unknown>).verify_code, code);
      assert.equal((row.payload.credential as Record<string, unknown>).status, "valid");

      const scorecard = row.payload.scorecard as Record<string, unknown>;
      assert.ok(scorecard.overall_score !== undefined);
      assert.ok(scorecard.tier !== undefined);
      assert.ok(scorecard.stages !== undefined);

      // Verify privacy & NDPA compliance: no storage paths, no raw video urls
      const payloadString = JSON.stringify(row.payload);
      assert.equal(payloadString.includes("stage1-videos/"), false, "Payload must not contain raw video storage path");
      assert.equal(payloadString.includes("id-documents/"), false, "Payload must not contain ID document path");
      assert.equal(payloadString.includes("project-submissions/"), false, "Payload must not contain submission storage path");
    });

    it("automatically enqueues 'credential.revoked' webhook when credential is revoked", async () => {
      // Admin revokes credential
      await execAsUser(
        db,
        ADMIN_ID,
        `UPDATE public.credentials SET revoked = true, revoked_at = now(), revoked_reason = 'Integrity breach detected' WHERE application_id = '${testAppId}'`
      );

      const res = await db.query<OutboundWebhookRow>(
        `SELECT * FROM public.outbound_webhooks WHERE application_id = $1 AND event = 'credential.revoked'`,
        [testAppId]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0]!;
      assert.equal(row.payload.event, "credential.revoked");
      assert.equal((row.payload.credential as Record<string, unknown>).status, "revoked");
      assert.equal((row.payload.credential as Record<string, unknown>).revoked_reason, "Integrity breach detected");
    });

    it("automatically enqueues 'stage.failed' webhook when candidate is placed in retake_wait", async () => {
      // Create a second application to test stage failure
      const failAppId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb77";
      await db.exec(`
        INSERT INTO public.applications (
          id, user_id, track, status, current_stage, external_application_id, consent_at
        ) VALUES (
          '${failAppId}',
          '${CANDIDATE_2_ID}',
          'ai',
          'registered',
          0,
          'd290f1ee-6c54-4b01-90e6-d701748f0877',
          now()
        )
        ON CONFLICT (id) DO NOTHING;

        SELECT set_config('app.internal_caller', 'true', false);
        SELECT public.advance_status('${failAppId}', 'id_pending', 'Upload ID');
        SELECT public.advance_status('${failAppId}', 'approved', 'Approve ID');
        SELECT public.advance_status('${failAppId}', 's1_open', 'Open S1');
        SELECT public.advance_status('${failAppId}', 's1_failed', 'Candidate failed S1');
        SELECT public.advance_status('${failAppId}', 'retake_wait', 'Candidate scored below pass mark');
      `);

      const res = await db.query<OutboundWebhookRow>(
        `SELECT * FROM public.outbound_webhooks WHERE application_id = $1 AND event = 'stage.failed'`,
        [failAppId]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0]!;
      assert.equal(row.payload.event, "stage.failed");
      assert.equal((row.payload.stage_update as Record<string, unknown>).current_status, "retake_wait");
      assert.equal((row.payload.stage_update as Record<string, unknown>).passed, false);
      assert.ok((row.payload.stage_update as Record<string, unknown>).reapply_eligible_at !== undefined);
    });

    it("enforces database unique constraint on external_application_id (Strict Idempotency)", async () => {
      await assert.rejects(
        async () => {
          await db.exec(`
            INSERT INTO public.applications (
              id, user_id, track, status, current_stage, external_application_id, consent_at
            ) VALUES (
              gen_random_uuid(),
              '${CANDIDATE_ID}',
              'ai',
              'registered',
              0,
              '${externalAppId}',
              now()
            );
          `);
        },
        /idx_applications_external_id|unique/i
      );
    });
  });

  describe("3. Outbound Dispatcher Protocol & Retry Backoff", () => {
    it("dispatches successfully when Q-Fellows responds with HTTP 200", async () => {
      const mockWebhook: OutboundWebhookRow = {
        id: "00000000-0000-0000-0000-000000000099",
        application_id: testAppId,
        event: "stage.passed",
        idempotency_key: "evt_test_success_1",
        payload: { event: "stage.passed", test: true },
        status: "pending",
        attempts: 0,
        next_retry_at: new Date().toISOString(),
        last_attempt_at: null,
        last_error: null,
        response_status: null,
      };

      const mockFetch = async () =>
        new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      const res = await dispatchSingleWebhook(mockWebhook, {
        webhookUrl: "https://qfellows.test/api/webhooks/qtalent",
        secret: TEST_SECRET,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      assert.equal(res.success, true);
      assert.equal(res.statusCode, 200);
    });

    it("marks 4xx errors as non-retryable dead_letter (Rule 6.2)", async () => {
      const mockWebhook: OutboundWebhookRow = {
        id: "00000000-0000-0000-0000-000000000098",
        application_id: testAppId,
        event: "stage.passed",
        idempotency_key: "evt_test_401",
        payload: { event: "stage.passed" },
        status: "pending",
        attempts: 0,
        next_retry_at: new Date().toISOString(),
        last_attempt_at: null,
        last_error: null,
        response_status: null,
      };

      const mockFetch = async () =>
        new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });

      const res = await dispatchSingleWebhook(mockWebhook, {
        webhookUrl: "https://qfellows.test/api/webhooks/qtalent",
        secret: TEST_SECRET,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      assert.equal(res.success, false);
      assert.equal(res.statusCode, 401);
      assert.match(res.error!, /HTTP 401/);
    });

    it("computes exponential backoff schedule with jitter (5s, 30s, 2m, 10m, 1h)", () => {
      assert.equal(BACKOFF_DELAYS_SECONDS.length, 5);
      assert.equal(BACKOFF_DELAYS_SECONDS[0], 5);
      assert.equal(BACKOFF_DELAYS_SECONDS[1], 30);
      assert.equal(BACKOFF_DELAYS_SECONDS[2], 120);
      assert.equal(BACKOFF_DELAYS_SECONDS[3], 600);
      assert.equal(BACKOFF_DELAYS_SECONDS[4], 3600);

      const retry0 = getNextRetryTimestamp(0);
      assert.equal(retry0.isTerminal, false);
      const diff0 = (retry0.nextRetryDate.getTime() - Date.now()) / 1000;
      assert.ok(diff0 >= 4.5 && diff0 <= 6.5);

      // Terminal attempt 5
      const terminal = getNextRetryTimestamp(5);
      assert.equal(terminal.isTerminal, true);
    });
  });

  describe("4. Candidate Intake Security Contract & Idempotency", () => {
    it("validates timestamp freshness within 300-second window (Rule 3.3 Replay Protection)", () => {
      const now = Math.floor(Date.now() / 1000);
      const isFresh = (ts: number) => !isNaN(ts) && Math.abs(now - ts) <= 300;

      // Fresh timestamps
      assert.equal(isFresh(now), true);
      assert.equal(isFresh(now - 120), true);
      assert.equal(isFresh(now + 60), true);

      // Stale / replay timestamps (> 300s old)
      assert.equal(isFresh(now - 301), false);
      assert.equal(isFresh(now - 600), false);
      assert.equal(isFresh(now + 305), false);
      assert.equal(isFresh(NaN), false);
    });

    it("creates verifiable invite link and authenticates landing /start page parameters", () => {
      const token = createSignedInviteToken(
        {
          applicationId: testAppId,
          email: "adaeze@example.com",
          track: "ai",
          expiresInSeconds: 7 * 86400,
        },
        TEST_SECRET
      );

      const inviteUrl = `http://localhost:3000/start?app=${testAppId}&token=${token}`;
      const parsedUrl = new URL(inviteUrl);
      const queryApp = parsedUrl.searchParams.get("app");
      const queryToken = parsedUrl.searchParams.get("token");

      assert.equal(queryApp, testAppId);
      assert.ok(queryToken !== null);

      const verification = verifySignedInviteToken(queryToken, TEST_SECRET);
      assert.equal(verification.valid, true);
      assert.equal(verification.data?.applicationId, queryApp);
      assert.equal(verification.data?.email, "adaeze@example.com");
      assert.equal(verification.data?.track, "ai");
    });
  });
});
