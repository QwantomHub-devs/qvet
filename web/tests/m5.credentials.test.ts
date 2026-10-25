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
const REVIEWER1_UNILAG_ID = "00000000-0000-0000-0000-000000000002";
const REVIEWER2_ABU_ID = "00000000-0000-0000-0000-000000000003";
const CANDIDATE1_UNILAG_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE2_ABU_ID = "00000000-0000-0000-0000-000000000005";
const UNILAG_INST_ID = "11111111-1111-1111-1111-111111111101";

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

describe("Milestone 5: Stage 4 Live Defence, Overall Scoring, Credentials & Public Verification", () => {
  let db: PGlite;
  let candidate1AppId: string;
  let candidate2AppId: string;

  before(async () => {
    db = new PGlite({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // Apply migrations 0001 through 0005 + seed
    const m1Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0001_m1_foundation.sql"), "utf8");
    const m2Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0002_m2_exam_engine.sql"), "utf8");
    const m3Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0003_m3_stage1_and_reviews.sql"), "utf8");
    const m4Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0004_m4_project_and_grader.sql"), "utf8");
    const m5Sql = fs.readFileSync(path.join(REPO_ROOT, "supabase/migrations/0005_m5_stage4_results_credentials.sql"), "utf8");
    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");

    await db.exec(m1Sql);
    await db.exec(m2Sql);
    await db.exec(m3Sql);
    await db.exec(m4Sql);
    await db.exec(m5Sql);
    await db.exec(seedSql);

    // Register Candidate 1 (UNILAG) and advance to s3_passed
    const res1 = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Chinedu Okafor', 'Nigeria', '+234 803 111 2222', 'https://github.com/chinedu-okafor',
        2.5, 'Python, ML, RAG', 'Africa/Lagos', 25,
        '${UNILAG_INST_ID}'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate1AppId = res1.rows[0]!.submit_onboarding.id;

    await execAsUser(
      db,
      CANDIDATE1_UNILAG_ID,
      `SELECT public.record_id_upload('${candidate1AppId}'::uuid, '${CANDIDATE1_UNILAG_ID}/${candidate1AppId}/id.pdf', 120000, 'application/pdf', 'NIN-1', 'Chinedu Okafor');`
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
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's3_open', 'Open S3');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's3_grading', 'Grading S3');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate1AppId}', 's3_passed', 'Pass S3');`);

    // Register Candidate 2 (ABU) and advance to s3_passed
    const res2 = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE2_ABU_ID,
      `SELECT row_to_json(public.submit_onboarding(
        'Amina Yusuf', 'Nigeria', '+234 803 222 3333', 'https://github.com/amina-yusuf',
        3.0, 'Python, ML, RAG', 'Africa/Lagos', 25,
        '11111111-1111-1111-1111-111111111102'::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding;`
    );
    candidate2AppId = res2.rows[0]!.submit_onboarding.id;

    await execAsUser(
      db,
      CANDIDATE2_ABU_ID,
      `SELECT public.record_id_upload('${candidate2AppId}'::uuid, '${CANDIDATE2_ABU_ID}/${candidate2AppId}/id.pdf', 120000, 'application/pdf', 'NIN-2', 'Amina Yusuf');`
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
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's3_open', 'Open S3');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's3_grading', 'Grading S3');`);
    await execAsUser(db, ADMIN_ID, `SELECT public.advance_status('${candidate2AppId}', 's3_passed', 'Pass S3');`);
  });

  after(async () => {
    if (db) await db.close();
  });

  it("1. books Stage 4 defence with meeting link and strictly enforces non-conflicting reviewer assignment", async () => {
    // Attempting to assign Reviewer 1 (UNILAG) to Candidate 1 (UNILAG) must fail with conflict of interest
    await assert.rejects(
      async () => {
        await execAsUser(
          db,
          ADMIN_ID,
          `SELECT public.book_stage4_defence(
            '${candidate1AppId}',
            (now() + interval '2 days'),
            'https://meet.google.com/abc-defg-hij',
            '${REVIEWER1_UNILAG_ID}'
          );`
        );
      },
      /Conflict of interest: reviewer cannot be assigned candidate from their own institution/i
    );

    // Auto-assignment automatically picks an eligible non-conflicting reviewer (e.g. ABU or UNN reviewer)
    const bookRes = await execAsUser<{ book_stage4_defence: any }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `SELECT row_to_json(public.book_stage4_defence(
        '${candidate1AppId}',
        (now() + interval '2 days'),
        'https://meet.google.com/abc-defg-hij'
      )) as book_stage4_defence;`
    );
    const booking = bookRes.rows[0]!.book_stage4_defence;
    assert.ok(booking.id);
    assert.notEqual(booking.reviewer_id, REVIEWER1_UNILAG_ID, "Must never assign same-institution reviewer");
    assert.equal(booking.status, "scheduled");

    // Check application status advanced to s4_scheduled
    const appRes = await db.query<{ status: string; current_stage: number }>(
      `SELECT status, current_stage FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s4_scheduled");
    assert.equal(appRes.rows[0]!.current_stage, 4);

    // Check review_assignments has corresponding row
    const raRes = await db.query<{ status: string; stage: number; part: string }>(
      `SELECT status, stage, part FROM public.review_assignments WHERE application_id = '${candidate1AppId}' AND stage = 4;`
    );
    assert.equal(raRes.rows[0]!.status, "assigned");
    assert.equal(raRes.rows[0]!.stage, 4);
    assert.equal(raRes.rows[0]!.part, "s4_defence");
  });

  it("2. enforces Stage 4 evaluation rules: understanding_own_work=1 triggers automatic failure regardless of average", async () => {
    // Book Candidate 2 with Reviewer 1 (UNILAG reviewer is eligible for Candidate 2 from ABU)
    const bookRes = await execAsUser<{ book_stage4_defence: any }>(
      db,
      ADMIN_ID,
      `SELECT row_to_json(public.book_stage4_defence(
        '${candidate2AppId}',
        (now() + interval '1 day'),
        'https://meet.google.com/xyz-uvw-rst',
        '${REVIEWER1_UNILAG_ID}'
      )) as book_stage4_defence;`
    );
    const bookingId = bookRes.rows[0]!.book_stage4_defence.id;

    // Fetch rubric criteria for Stage 4
    const critRes = await db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM public.rubric_criteria WHERE rubric_id IN (
        SELECT id FROM public.rubrics WHERE stage = 4 AND part = 's4_defence'
      );`
    );
    const criteria = critRes.rows;

    // Scores where understanding_own_work = 1, but other 4 are 4. Average = (1+4+4+4+4)/5 = 3.4 (>= 2.50)
    // Blueprint §7.1: Score of 1 in understanding of own work is an AUTOMATIC FAIL
    const failScores = criteria.map((c) => ({
      criterion_id: c.id,
      score: c.slug === "understanding_own_work" ? 1 : 4,
      comment: c.slug === "understanding_own_work" ? "Could not explain submitted code" : "Strong",
    }));

    const scoreRes = await execAsUser<{ submit_stage4_review: any }>(
      db,
      REVIEWER1_UNILAG_ID,
      `SELECT public.submit_stage4_review(
        '${bookingId}',
        '${JSON.stringify(failScores)}'::jsonb,
        'Cannot explain submitted architecture'
      );`
    );
    const result = scoreRes.rows[0]!.submit_stage4_review;
    assert.equal(result.average_score, 3.4);
    assert.equal(result.understanding_own_work, 1);
    assert.equal(result.passed, false, "Must fail automatically when understanding_own_work = 1");

    // Status advances to s4_failed
    const appRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate2AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s4_failed");
  });

  it("3. passes Stage 4 when average >= 2.5 and understanding_own_work > 1", async () => {
    // Retrieve Candidate 1 booking
    const bookRes = await db.query<{ id: string; reviewer_id: string }>(
      `SELECT id, reviewer_id FROM public.stage4_bookings WHERE application_id = '${candidate1AppId}';`
    );
    const booking = bookRes.rows[0]!;

    const critRes = await db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM public.rubric_criteria WHERE rubric_id IN (
        SELECT id FROM public.rubrics WHERE stage = 4 AND part = 's4_defence'
      );`
    );
    const criteria = critRes.rows;

    // Scores: 3, 3, 3, 4, 3 -> sum = 16 / 5 = 3.20 (>= 2.50), understanding = 3 (> 1)
    const passScores = criteria.map((c) => ({
      criterion_id: c.id,
      score: c.slug === "communication" ? 4 : 3,
      comment: "Clear explanations and solid engineering rationale",
    }));

    const scoreRes = await execAsUser<{ submit_stage4_review: any }>(
      db,
      booking.reviewer_id,
      `SELECT public.submit_stage4_review(
        '${booking.id}',
        '${JSON.stringify(passScores)}'::jsonb,
        'Clear walkthrough and solid trade-off discussion'
      );`
    );
    const result = scoreRes.rows[0]!.submit_stage4_review;
    assert.equal(result.average_score, 3.2);
    assert.equal(result.passed, true);
    // ((3.2 - 1.0)/3.0) * 100 = 73.33%
    assert.equal(result.percent, 73.33);

    // Status advances to s4_passed
    const appRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "s4_passed");
  });

  it("4. compute_overall calculates exact mathematical weights and enforces tier thresholds & stage minimums", async () => {
    // Populate worked examples into stage_results for Candidate 1:
    // Formula: 0.15 * S1 + 0.25 * S2 + 0.35 * S3 + 0.25 * S4
    // Target 1: Exact threshold 70.00 for Certified
    // S1=70.0, S2=70.0, S3=70.0, S4_avg=2.1 (raw_score=2.50 -> percent=50.00)
    // S1=70*0.15 = 10.5
    // S2=70*0.25 = 17.5
    // S3=70*0.35 = 24.5
    // S4=70*0.25 = 17.5
    // Sum = 70.00
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      INSERT INTO public.stage_results (application_id, stage, raw_score, percent, passed)
      VALUES
        ('${candidate1AppId}', 1, 70.0, 70.0, true),
        ('${candidate1AppId}', 2, 70.0, 70.0, true),
        ('${candidate1AppId}', 3, 70.0, 70.0, true),
        ('${candidate1AppId}', 4, 3.10, 70.0, true)
      ON CONFLICT (application_id, stage) DO UPDATE
      SET raw_score = excluded.raw_score, percent = excluded.percent, passed = excluded.passed;
    `);

    const res70 = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    const data70 = res70.rows[0]!.compute_overall;
    assert.equal(data70.overall, 70.00);
    assert.equal(data70.tier, "certified", "Overall = 70.00 must qualify for Certified tier");

    // Target 2: Score 69.99 is below 70.00 -> tier must be NULL
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results
      SET percent = 69.96
      WHERE application_id = '${candidate1AppId}' AND stage = 3;
    `);
    // 0.15*70 + 0.25*70 + 0.35*69.96 + 0.25*70 = 10.5 + 17.5 + 24.486 + 17.5 = 69.986 -> 69.99
    const res69 = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    const data69 = res69.rows[0]!.compute_overall;
    assert.equal(data69.overall, 69.99);
    assert.equal(data69.tier, null, "Score 69.99 must not qualify for Certified tier");

    // Target 3: Certified Pro: Overall >= 80 AND Stage 3 >= 75
    // S1=80 (12.0), S2=80 (20.0), S3=80 (28.0), S4=80 (20.0) -> Sum = 80.00, S3=80 >= 75
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results SET percent = 80.0 WHERE application_id = '${candidate1AppId}';
    `);
    const res80 = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    assert.equal(res80.rows[0]!.compute_overall.overall, 80.00);
    assert.equal(res80.rows[0]!.compute_overall.tier, "certified_pro");

    // Target 4: Overall >= 80 BUT Stage 3 < 75 -> receives 'certified', NOT 'certified_pro'
    // S1=90 (13.5), S2=90 (22.5), S3=70 (24.5), S4=90 (22.5) -> Sum = 83.00, but S3=70 < 75
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results SET percent = 90.0 WHERE application_id = '${candidate1AppId}' AND stage IN (1, 2, 4);
      UPDATE public.stage_results SET percent = 70.0 WHERE application_id = '${candidate1AppId}' AND stage = 3;
    `);
    const res83 = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    assert.equal(res83.rows[0]!.compute_overall.overall, 83.00);
    assert.equal(res83.rows[0]!.compute_overall.tier, "certified", "Stage 3 < 75 must restrict tier to certified");

    // Target 5: Elite: Overall >= 90 AND Stage 4 avg >= 3.50
    // S1=92 (13.8), S2=92 (23.0), S3=92 (32.2), S4=92 (23.0) -> Sum = 92.00, S4_raw = 3.60 >= 3.50
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results SET percent = 92.0 WHERE application_id = '${candidate1AppId}';
      UPDATE public.stage_results SET raw_score = 3.60 WHERE application_id = '${candidate1AppId}' AND stage = 4;
    `);
    const resElite = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    assert.equal(resElite.rows[0]!.compute_overall.overall, 92.00);
    assert.equal(resElite.rows[0]!.compute_overall.tier, "elite");

    // Target 6: High overall but fails one stage minimum (< 60%) -> certification denied
    // S1=90 (13.5), S2=55 (13.75 - FAILED), S3=90 (31.5), S4=90 (22.5) -> Overall = 81.25, but S2 < 60%
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results SET percent = 90.0, passed = true WHERE application_id = '${candidate1AppId}' AND stage IN (1, 3, 4);
      UPDATE public.stage_results SET percent = 55.0, passed = false WHERE application_id = '${candidate1AppId}' AND stage = 2;
    `);
    const resFailMin = await db.query<{ compute_overall: any }>(
      `SELECT public.compute_overall('${candidate1AppId}');`
    );
    assert.equal(resFailMin.rows[0]!.compute_overall.all_minima_met, false);
    assert.equal(resFailMin.rows[0]!.compute_overall.tier, null, "Must deny credential if any stage minimum is failed");
  });

  it("5. admin issues credential with unguessable verify_code and 24-month expiry, and advances status to certified", async () => {
    // Restore Candidate 1 to passing elite state
    await db.exec(`
      SET app.allow_stage_result_write = 'true';
      UPDATE public.stage_results SET percent = 92.0, raw_score = 92.0, passed = true WHERE application_id = '${candidate1AppId}';
      UPDATE public.stage_results SET raw_score = 3.75 WHERE application_id = '${candidate1AppId}' AND stage = 4;
    `);

    // Non-admin cannot issue credentials
    await assert.rejects(
      async () => {
        await execAsUser(db, CANDIDATE1_UNILAG_ID, `SELECT public.admin_issue_credential('${candidate1AppId}');`);
      },
      /Access denied: only admins can issue credentials/i
    );

    // Admin issues credential
    const credRes = await execAsUser<{ admin_issue_credential: any }>(
      db,
      ADMIN_ID,
      `SELECT row_to_json(public.admin_issue_credential('${candidate1AppId}')) as admin_issue_credential;`
    );
    const cred = credRes.rows[0]!.admin_issue_credential;
    assert.ok(cred.id);
    assert.equal(cred.tier, "elite");
    assert.equal(cred.overall, 92.00);
    assert.ok(cred.verify_code.startsWith("VET-"), "Verify code must have VET- prefix");
    assert.equal(cred.revoked, false);

    // Verify 24-month expiry
    const issuedDate = new Date(cred.issued_at).getTime();
    const expiryDate = new Date(cred.expires_at).getTime();
    const diffMonths = Math.round((expiryDate - issuedDate) / (1000 * 60 * 60 * 24 * 30));
    assert.equal(diffMonths, 24);

    // Application status advanced to certified
    const appRes = await db.query<{ status: string }>(
      `SELECT status FROM public.applications WHERE id = '${candidate1AppId}';`
    );
    assert.equal(appRes.rows[0]!.status, "certified");
  });

  it("6. public verification endpoint is open to all, leaks zero PII, and accurately reflects revoked credentials", async () => {
    const cred = (await db.query<{ id: string; verify_code: string }>(
      `SELECT id, verify_code FROM public.credentials WHERE application_id = '${candidate1AppId}';`
    )).rows[0]!;

    // 1. Anonymous / Public query to get_public_credential_verification
    const pubRes = await db.query<{ get_public_credential_verification: any }>(
      `SELECT public.get_public_credential_verification('${cred.verify_code}');`
    );
    const pubData = pubRes.rows[0]!.get_public_credential_verification;

    // Verify required fields are present
    assert.equal(pubData.found, true);
    assert.equal(pubData.full_name, "Chinedu Okafor");
    assert.equal(pubData.track, "ai");
    assert.equal(pubData.tier, "elite");
    assert.equal(pubData.status, "valid");
    assert.equal(pubData.is_valid, true);
    assert.equal(pubData.verify_code, cred.verify_code);

    // Verify zero PII leakage: NO email, NO phone, NO institution, NO user_id, NO question details
    assert.equal(pubData.user_id, undefined);
    assert.equal(pubData.email, undefined);
    assert.equal(pubData.phone, undefined);
    assert.equal(pubData.institution_id, undefined);
    assert.equal(pubData.scores, undefined);
    assert.equal(pubData.comment, undefined);

    // 2. Admin revokes credential
    await execAsUser(
      db,
      ADMIN_ID,
      `SELECT public.admin_revoke_credential('${cred.id}', 'Confirmed identity violation during audit');`
    );

    // 3. Public query immediately reports status = 'revoked' and is_valid = false
    const revokedRes = await db.query<{ get_public_credential_verification: any }>(
      `SELECT public.get_public_credential_verification('${cred.verify_code}');`
    );
    const revokedData = revokedRes.rows[0]!.get_public_credential_verification;
    assert.equal(revokedData.status, "revoked");
    assert.equal(revokedData.is_valid, false);
  });

  it("7. generates employer scorecard with domain breakdowns, project points, and communication rating", async () => {
    const cred = (await db.query<{ verify_code: string }>(
      `SELECT id, verify_code FROM public.credentials WHERE application_id = '${candidate1AppId}';`
    )).rows[0]!;

    const scRes = await db.query<{ get_employer_scorecard: any }>(
      `SELECT public.get_employer_scorecard('${cred.verify_code}');`
    );
    const card = scRes.rows[0]!.get_employer_scorecard;

    assert.equal(card.found, true);
    assert.equal(card.full_name, "Chinedu Okafor");
    assert.equal(card.tier, "elite");
    assert.equal(card.overall, 92.00);
    assert.ok(card.stage_percentages);
    assert.equal(card.stage_percentages.stage_1_foundation, 92.0);
    assert.ok(card.communication_rating);
  });
});
