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
const CANDIDATE1_UNILAG_ID = "00000000-0000-0000-0000-000000000004";
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
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      current_user
    );
  $$;

  CREATE SCHEMA IF NOT EXISTS storage;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    public boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
    name text NOT NULL,
    owner uuid DEFAULT auth.uid(),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (bucket_id, name)
  );

  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

  CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  AS $$
    SELECT string_to_array(name, '/');
  $$;

  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
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

describe("M3 Stage 1 Foundation Screen, Blind Review, Peer Score Isolation & Third-Review Rule", () => {
  let db: PGlite;
  let app1Id = "";
  let textRespId = "";
  let videoRespId = "";

  before(async () => {
    db = await PGlite.create({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    const migrationsDir = path.join(REPO_ROOT, "supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await db.exec(sql);
    }

    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Prepare Candidate 1 (UNILAG) -> approved
    const c1App = await execAsUser<{ submit_onboarding: { id: string } }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select row_to_json(public.submit_onboarding(
        'Chinedu Okafor', 'Nigeria', '+234 803 111 2222', 'https://github.com/chinedu-okafor',
        2.5, 'Python, ML, RAG', 'Africa/Lagos', 25,
        $1::uuid, null, 'ai', null, '{}'::jsonb, true
      )) as submit_onboarding`,
      [UNILAG_INST_ID]
    );
    app1Id = c1App.rows[0]!.submit_onboarding.id;

    await execAsUser(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.record_id_upload($1::uuid, $2, 120000, 'application/pdf', 'NIN-1', 'Chinedu Okafor')`,
      [app1Id, `${CANDIDATE1_UNILAG_ID}/${app1Id}/id.pdf`]
    );

    await execAsUser(
      db,
      ADMIN_ID,
      `select public.admin_verify_id($1::uuid, 'approved', 'ID verified')`,
      [app1Id]
    );
  });

  after(async () => {
    await db.close();
  });

  it("enables RLS on all 6 M3 tables and starts Stage 1 Part A with 10s autosave and locking", async () => {
    const rlsCheck = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('prompts', 'responses', 'rubrics', 'rubric_criteria', 'review_assignments', 'review_scores')`
    );
    assert.equal(rlsCheck.rows.length, 6);
    for (const r of rlsCheck.rows) {
      assert.equal(r.relrowsecurity, true, `Expected RLS on ${r.relname}`);
    }

    // Start Part A (written explanation)
    const startA = await execAsUser<{ start_stage1_part: Record<string, unknown> }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.start_stage1_part($1::uuid, 'text')`,
      [app1Id]
    );
    const respObj = startA.rows[0]!.start_stage1_part.response as { id: string; locked: boolean };
    textRespId = respObj.id;
    assert.equal(respObj.locked, false);

    // Autosave draft text
    const saveRes = await execAsUser<{ save_text_response: { word_count: number } }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.save_text_response($1::uuid, 'First autosaved draft with seven words here.')`,
      [app1Id]
    );
    assert.equal(saveRes.rows[0]!.save_text_response.word_count, 7);

    // Submit and lock Part A written response
    const submitRes = await execAsUser<{
      submit_text_response: { response: { locked: boolean }; reviewers_assigned: number };
    }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.submit_text_response(
        $1::uuid,
        'When 95% of transactions are legitimate, a model that predicts legitimate for every transaction achieves 95% accuracy while catching 0% of fraud. We should inspect precision and recall on the fraud class instead.'
      )`,
      [app1Id]
    );
    assert.equal(submitRes.rows[0]!.submit_text_response.response.locked, true);
    assert.equal(submitRes.rows[0]!.submit_text_response.reviewers_assigned, 2);

    // Attempting to autosave after lock is rejected
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_UNILAG_ID,
          `select public.save_text_response($1::uuid, 'Late edit attempt')`,
          [app1Id]
        ),
      /already locked/i
    );
  });

  it("proves a reviewer never sees candidate name or institution and cannot be assigned same-institution work", async () => {
    // 1. Verify Reviewer 1 (also at UNILAG) was NOT assigned to Candidate 1's response
    const assignments = await db.query<{
      id: string;
      reviewer_id: string;
      review_round: number;
    }>(
      `select id, reviewer_id, review_round
       from public.review_assignments
       where response_id = $1::uuid
       order by review_round asc`,
      [textRespId]
    );
    assert.equal(assignments.rows.length, 2);
    for (const a of assignments.rows) {
      assert.notEqual(
        a.reviewer_id,
        REVIEWER1_UNILAG_ID,
        "Reviewer from UNILAG must never be assigned to a candidate from UNILAG"
      );
    }

    // 2. Prove database trigger rejects manual assignment of same-institution reviewer
    await assert.rejects(
      () =>
        execAsUser(
          db,
          ADMIN_ID,
          `insert into public.review_assignments (application_id, response_id, stage, part, reviewer_id, review_round)
           values ($1::uuid, $2::uuid, 1, 's1_text', $3::uuid, 3)`,
          [app1Id, textRespId, REVIEWER1_UNILAG_ID]
        ),
      /Conflict of interest: reviewer cannot be assigned work from their own institution/i
    );

    // 3. Prove assigned reviewer cannot read candidate profiles or applications directly
    const firstReviewerId = assignments.rows[0]!.reviewer_id;
    const revProfiles = await execAsUser<{ user_id: string; full_name: string }>(
      db,
      firstReviewerId,
      `select user_id, full_name from public.profiles`
    );
    assert.equal(revProfiles.rows.length, 1);
    assert.equal(revProfiles.rows[0]!.user_id, firstReviewerId);

    const revApps = await execAsUser(
      db,
      firstReviewerId,
      `select * from public.applications`
    );
    assert.equal(revApps.rows.length, 0);

    // 4. Prove get_reviewer_queue() strips candidate name and institution
    const queueRes = await execAsUser<{ get_reviewer_queue: Array<Record<string, unknown>> }>(
      db,
      firstReviewerId,
      `select public.get_reviewer_queue()`
    );
    const queue = queueRes.rows[0]!.get_reviewer_queue;
    assert.equal(queue.length, 1);
    const serialized = JSON.stringify(queue);
    assert.equal(serialized.includes("Chinedu"), false);
    assert.equal(serialized.includes("Okafor"), false);
    assert.equal(serialized.includes("UNILAG"), false);
    assert.equal(serialized.includes("University of Lagos"), false);
    assert.match(String(queue[0]!.anonymous_candidate_ref), /^CAND-[0-9A-F]{8}$/);
  });

  it("proves a reviewer cannot see the other reviewer's score before submitting, and triggers 3rd reviewer when scores differ by > 1", async () => {
    const assignments = await db.query<{
      id: string;
      reviewer_id: string;
      review_round: number;
    }>(
      `select id, reviewer_id, review_round
       from public.review_assignments
       where response_id = $1::uuid
       order by review_round asc`,
      [textRespId]
    );
    const r1Assignment = assignments.rows[0]!;
    const r2Assignment = assignments.rows[1]!;

    // First reviewer submits 4 across all 4 criteria (avg = 4.00)
    const r1Submit = await execAsUser<{ submit_review: Record<string, unknown> }>(
      db,
      r1Assignment.reviewer_id,
      `select public.submit_review(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000001', 'score', 4, 'comment', 'Very clear'),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000002', 'score', 4, 'comment', 'Well structured'),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000003', 'score', 4, 'comment', 'Accurate'),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000004', 'score', 4, 'comment', 'Clean grammar')
        )
      )`,
      [r1Assignment.id]
    );
    assert.equal(Number(r1Submit.rows[0]!.submit_review.avg_score), 4);

    // BEFORE submitting their own review, Second Reviewer tries to read review_scores, peer review_assignments, and get_reviewer_queue()
    const r2ScoresBefore = await execAsUser(
      db,
      r2Assignment.reviewer_id,
      `select * from public.review_scores`
    );
    assert.equal(
      r2ScoresBefore.rows.length,
      0,
      "Second reviewer must not see first reviewer's scores before submitting their own"
    );

    const r2AssignmentsBefore = await execAsUser<{ id: string }>(
      db,
      r2Assignment.reviewer_id,
      `select id from public.review_assignments where response_id = $1::uuid`,
      [textRespId]
    );
    assert.equal(
      r2AssignmentsBefore.rows.length,
      1,
      "Second reviewer only sees their own assignment row before submitting"
    );

    const r2QueueBefore = await execAsUser<{ get_reviewer_queue: Array<Record<string, unknown>> }>(
      db,
      r2Assignment.reviewer_id,
      `select public.get_reviewer_queue()`
    );
    const peerReviewsBefore = r2QueueBefore.rows[0]!.get_reviewer_queue[0]!
      .peer_reviews as unknown[];
    assert.equal(peerReviewsBefore.length, 0);

    // Also verify Candidate 1 can NEVER read review_scores or review_assignments
    const candScores = await execAsUser(
      db,
      CANDIDATE1_UNILAG_ID,
      `select * from public.review_scores`
    );
    assert.equal(candScores.rows.length, 0);

    // Second reviewer submits 2 across all 4 criteria (avg = 2.00) -> diff = |4.0 - 2.0| = 2.0 > 1.0 -> triggers 3rd reviewer!
    const r2Submit = await execAsUser<{ submit_review: Record<string, unknown> }>(
      db,
      r2Assignment.reviewer_id,
      `select public.submit_review(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000001', 'score', 2),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000002', 'score', 2),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000003', 'score', 2),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000004', 'score', 2)
        )
      )`,
      [r2Assignment.id]
    );
    assert.equal(r2Submit.rows[0]!.submit_review.third_review_triggered, true);
    assert.equal(r2Submit.rows[0]!.submit_review.final_rubric_avg, null);

    // AFTER submitting their own review, Second Reviewer CAN see peer scores
    const r2ScoresAfter = await execAsUser(
      db,
      r2Assignment.reviewer_id,
      `select * from public.review_scores`
    );
    assert.equal(r2ScoresAfter.rows.length, 8);

    // Verify 3rd reviewer was assigned (and is also NOT from UNILAG)
    const r3Row = await db.query<{ id: string; reviewer_id: string; is_third_review: boolean }>(
      `select id, reviewer_id, is_third_review
       from public.review_assignments
       where response_id = $1::uuid and review_round = 3`,
      [textRespId]
    );
    assert.equal(r3Row.rows.length, 1);
    assert.equal(r3Row.rows[0]!.is_third_review, true);
    assert.notEqual(r3Row.rows[0]!.reviewer_id, REVIEWER1_UNILAG_ID);

    // 3rd reviewer submits 3 across all 4 criteria (avg = 3.00) -> resolves Part A final_rubric_avg = 3.00 (66.67%)
    const r3Submit = await execAsUser<{ submit_review: Record<string, unknown> }>(
      db,
      r3Row.rows[0]!.reviewer_id,
      `select public.submit_review(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000001', 'score', 3),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000002', 'score', 3),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000003', 'score', 3),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000004', 'score', 3)
        )
      )`,
      [r3Row.rows[0]!.id]
    );
    assert.equal(Number(r3Submit.rows[0]!.submit_review.final_rubric_avg), 3);
    assert.equal(Number(r3Submit.rows[0]!.submit_review.final_percent), 66.67);
  });

  it("completes Part B video and Part C 15-question logic exam, computes Stage 1 result, and unlocks Stage 2", async () => {
    // 1. Candidate 1 starts Part B (video) and submits a 2-minute low-res video
    const startB = await execAsUser<{ start_stage1_part: { response: { id: string } } }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.start_stage1_part($1::uuid, 'video')`,
      [app1Id]
    );
    videoRespId = startB.rows[0]!.start_stage1_part.response.id;

    // Reject oversized video (> 25 MB)
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_UNILAG_ID,
          `select public.submit_video_response($1::uuid, $2, 30000000, 'video/webm', 110)`,
          [app1Id, `${CANDIDATE1_UNILAG_ID}/${app1Id}/video.webm`]
        ),
      /25 MB/i
    );

    const submitB = await execAsUser<{
      submit_video_response: { response: { locked: boolean }; reviewers_assigned: number };
    }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.submit_video_response($1::uuid, $2, 8500000, 'video/webm', 115)`,
      [app1Id, `${CANDIDATE1_UNILAG_ID}/${app1Id}/video.webm`]
    );
    assert.equal(submitB.rows[0]!.submit_video_response.response.locked, true);
    assert.equal(submitB.rows[0]!.submit_video_response.reviewers_assigned, 2);

    // 2. Both assigned reviewers score Part B within 1.0 point (3.00 and 4.00 -> diff = 1.00 <= 1.00 -> no 3rd review!)
    const videoAssignments = await db.query<{ id: string; reviewer_id: string }>(
      `select id, reviewer_id from public.review_assignments where response_id = $1::uuid order by review_round asc`,
      [videoRespId]
    );
    assert.equal(videoAssignments.rows.length, 2);

    await execAsUser(
      db,
      videoAssignments.rows[0]!.reviewer_id,
      `select public.submit_review(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000005', 'score', 3),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000006', 'score', 3),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000007', 'score', 3)
        )
      )`,
      [videoAssignments.rows[0]!.id]
    );

    const vRev2 = await execAsUser<{ submit_review: Record<string, unknown> }>(
      db,
      videoAssignments.rows[1]!.reviewer_id,
      `select public.submit_review(
        $1::uuid,
        jsonb_build_array(
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000005', 'score', 4),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000006', 'score', 4),
          jsonb_build_object('criterion_id', '66666666-6666-6666-6666-000000000007', 'score', 4)
        )
      )`,
      [videoAssignments.rows[1]!.id]
    );
    assert.equal(vRev2.rows[0]!.submit_review.third_review_triggered, false);
    assert.equal(Number(vRev2.rows[0]!.submit_review.final_rubric_avg), 3.5);
    assert.equal(Number(vRev2.rows[0]!.submit_review.final_percent), 83.33);

    // 3. Candidate 1 starts Part C (15-item logic exam reusing the exam engine with stage = 1)
    const startC = await execAsUser<{ start_exam: Record<string, unknown> }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select public.start_exam($1::uuid, 1)`,
      [app1Id]
    );
    const logicAttemptId = String(startC.rows[0]!.start_exam.attempt_id);
    assert.equal(startC.rows[0]!.start_exam.total_questions, 15);

    // Answer 12 of 15 correctly (80.00%)
    for (let idx = 0; idx < 15; idx++) {
      const qRes = await execAsUser<{ get_question: Record<string, unknown> }>(
        db,
        CANDIDATE1_UNILAG_ID,
        `select public.get_question($1::uuid)`,
        [logicAttemptId]
      );
      const q = qRes.rows[0]!.get_question;
      const ans = idx < 12 ? "A" : "D";
      await execAsUser(
        db,
        CANDIDATE1_UNILAG_ID,
        `select public.submit_answer($1::uuid, $2::uuid, $3)`,
        [logicAttemptId, String(q.question_id), ans]
      );
    }

    // 4. Verify Stage 1 final score: 0.40 * 66.67 + 0.30 * 83.33 + 0.30 * 80.00 = 75.67% -> PASSED -> s2_open!
    const s1Res = await execAsUser<{ percent: string; passed: boolean }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select percent::text, passed from public.stage_results where application_id = $1::uuid and stage = 1`,
      [app1Id]
    );
    assert.equal(s1Res.rows.length, 1);
    assert.equal(Number(s1Res.rows[0]!.percent), 75.67);
    assert.equal(s1Res.rows[0]!.passed, true);

    const appAfter = await execAsUser<{ status: string; current_stage: number }>(
      db,
      CANDIDATE1_UNILAG_ID,
      `select status, current_stage from public.applications where id = $1::uuid`,
      [app1Id]
    );
    assert.equal(appAfter.rows[0]?.status, "s2_open");
    assert.equal(appAfter.rows[0]?.current_stage, 2);
  });

  it("allows admins to edit rubric criteria and anchor descriptions in the database while blocking non-admins", async () => {
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_UNILAG_ID,
          `select public.admin_update_rubric_criterion(
            '66666666-6666-6666-6666-000000000001'::uuid,
            'Hacked Criterion',
            '{"1":"a","2":"b","3":"c","4":"d"}'::jsonb
          )`
        ),
      /Only administrators can edit rubric criteria/i
    );

    const updated = await execAsUser<{
      admin_update_rubric_criterion: { criterion: string; anchors: Record<string, string> };
    }>(
      db,
      ADMIN_ID,
      `select row_to_json(public.admin_update_rubric_criterion(
        '66666666-6666-6666-6666-000000000001'::uuid,
        'Clarity for Non-Technical Stakeholders',
        '{"1":"Unclear","2":"Somewhat clear","3":"Clear and plain English","4":"Crystal clear with concrete example"}'::jsonb
      )) as admin_update_rubric_criterion`
    );
    assert.equal(
      updated.rows[0]!.admin_update_rubric_criterion.criterion,
      "Clarity for Non-Technical Stakeholders"
    );
  });
});
