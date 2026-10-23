import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { parseQuestionsCsv } from "../src/lib/validation/csv-questions.ts";

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
const CANDIDATE1_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE2_ID = "00000000-0000-0000-0000-000000000005";

async function execAsUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  await db.exec("BEGIN");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await db.exec(`set local role authenticated`);
    const result = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return { rows: result.rows };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

describe("M2 Exam Engine: Question Bank, Blueprint Draw, Timer, Locking, Numeric Tolerance & Auto-Submit", () => {
  let db: PGlite;
  let app1Id: string;
  let app2Id: string;
  let attempt1Id: string;

  before(async () => {
    db = await PGlite.create({
      extensions: { pgcrypto },
    });

    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    const m1Sql = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/0001_m1_foundation.sql"),
      "utf8"
    );
    await db.exec(m1Sql);

    const m2Sql = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/0002_m2_exam_engine.sql"),
      "utf8"
    );
    await db.exec(m2Sql);

    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);

    // Onboard and approve both Candidate 1 and Candidate 2, then unlock Stage 2 (`s2_open`)
    const c1App = await execAsUser<{ id: string }>(
      db,
      CANDIDATE1_ID,
      `select id from public.submit_onboarding(
        'Chinedu Okafor', 'Nigeria', '+234 803 111 2222', 'https://github.com/chinedu-okafor',
        2.5, 'Python, ML, RAG', 'Africa/Lagos', 25,
        '11111111-1111-1111-1111-111111111101'::uuid, null, 'ai', null, '{}'::jsonb, true
      )`
    );
    app1Id = c1App.rows[0]!.id;
    const c1Path = `${CANDIDATE1_ID}/${app1Id}/id.pdf`;
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
      [c1Path]
    );
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `select public.record_id_upload($1::uuid, $2, 120000, 'application/pdf', 'NIN-11112222', 'Chinedu Okafor')`,
      [app1Id, c1Path]
    );

    const c2App = await execAsUser<{ id: string }>(
      db,
      CANDIDATE2_ID,
      `select id from public.submit_onboarding(
        'Amina Yusuf', 'Nigeria', '+234 809 333 4444', 'https://github.com/amina-yusuf',
        3.0, 'Python, ML, Evaluation', 'Africa/Lagos', 30,
        '11111111-1111-1111-1111-111111111102'::uuid, null, 'ai', null, '{}'::jsonb, true
      )`
    );
    app2Id = c2App.rows[0]!.id;
    const c2Path = `${CANDIDATE2_ID}/${app2Id}/id.pdf`;
    await execAsUser(
      db,
      CANDIDATE2_ID,
      `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
      [c2Path]
    );
    await execAsUser(
      db,
      CANDIDATE2_ID,
      `select public.record_id_upload($1::uuid, $2, 120000, 'application/pdf', 'NIN-33334444', 'Amina Yusuf')`,
      [app2Id, c2Path]
    );

    await execAsUser(db, ADMIN_ID, `select public.admin_verify_id($1::uuid, 'approved', 'OK')`, [
      app1Id,
    ]);
    await execAsUser(db, ADMIN_ID, `select public.admin_unlock_stage2($1::uuid)`, [app1Id]);

    await execAsUser(db, ADMIN_ID, `select public.admin_verify_id($1::uuid, 'approved', 'OK')`, [
      app2Id,
    ]);
    await execAsUser(db, ADMIN_ID, `select public.admin_unlock_stage2($1::uuid)`, [app2Id]);
  });

  after(async () => {
    await db.close();
  });

  it("proves candidates cannot fetch correct answers or raw question bank by any request", async () => {
    const keysRes = await execAsUser(db, CANDIDATE1_ID, `select * from public.question_keys`);
    assert.equal(keysRes.rows.length, 0, "Candidate must never read question_keys");

    const questionsRes = await execAsUser(db, CANDIDATE1_ID, `select * from public.questions`);
    assert.equal(questionsRes.rows.length, 0, "Candidate must never read raw questions table");

    const answersRes = await execAsUser(db, CANDIDATE1_ID, `select * from public.exam_answers`);
    assert.equal(answersRes.rows.length, 0, "Candidate must never read raw exam_answers table");
  });

  it("draws 40 questions matching exact blueprint domain counts (8,10,8,4,6,4) and 40/40/20 difficulty distribution", async () => {
    const startRes = await execAsUser<{ start_exam: Record<string, unknown> }>(
      db,
      CANDIDATE1_ID,
      `select public.start_exam($1::uuid)`,
      [app1Id]
    );
    const payload = startRes.rows[0]!.start_exam;
    attempt1Id = String(payload.attempt_id);

    assert.equal(payload.total_questions, 40);
    assert.equal(payload.current_index, 0);
    assert.equal(payload.resumed, false);
    assert.ok(Number(payload.remaining_seconds) > 3500 && Number(payload.remaining_seconds) <= 3600);

    // Check drawn domain distribution
    const domainDist = await db.query<{ domain: string; cnt: number }>(
      `select q.domain, count(*)::int as cnt
       from public.exam_attempts ea, unnest(ea.question_ids) as qid
       join public.questions q on q.id = qid
       where ea.id = $1::uuid
       group by q.domain`,
      [attempt1Id]
    );
    const domainMap = Object.fromEntries(domainDist.rows.map((r) => [r.domain, r.cnt]));
    assert.deepEqual(domainMap, {
      python_data: 8,
      stats_ml: 10,
      eval_debugging: 8,
      dl_nlp: 4,
      llm_apps: 6,
      eng_practice: 4,
    });

    // Check drawn difficulty distribution: 40% easy (16), 40% medium (16), 20% hard (8)
    const diffDist = await db.query<{ difficulty: string; cnt: number }>(
      `select q.difficulty, count(*)::int as cnt
       from public.exam_attempts ea, unnest(ea.question_ids) as qid
       join public.questions q on q.id = qid
       where ea.id = $1::uuid
       group by q.difficulty`,
      [attempt1Id]
    );
    const diffMap = Object.fromEntries(diffDist.rows.map((r) => [r.difficulty, r.cnt]));
    assert.deepEqual(diffMap, {
      easy: 16,
      medium: 16,
      hard: 8,
    });
  });

  it("enforces one-question-at-a-time delivery, locks answers, makes going back impossible, and resumes with remaining time on refresh", async () => {
    // Serve index 0
    const q0Res = await execAsUser<{ get_question: Record<string, unknown> }>(
      db,
      CANDIDATE1_ID,
      `select public.get_question($1::uuid, 0)`,
      [attempt1Id]
    );
    const q0 = q0Res.rows[0]!.get_question;
    assert.equal(q0.question_index, 0);
    assert.equal("correct" in q0, false, "Served question must never contain correct key");
    assert.equal("explanation" in q0, false, "Served question must never contain explanation");

    // Cannot skip ahead to index 1 before answering index 0
    await assert.rejects(
      () =>
        execAsUser(db, CANDIDATE1_ID, `select public.get_question($1::uuid, 1)`, [attempt1Id]),
      /Navigation to question index 1 is forbidden; current unanswered index is 0/i
    );

    // Submit answer for index 0 (intentionally correct: 'A' for MCQ or '0.81' within tolerance for numeric)
    const firstAns = q0.type === "numeric" ? "0.81" : "A";
    const sub0 = await execAsUser<{ submit_answer: Record<string, unknown> }>(
      db,
      CANDIDATE1_ID,
      `select public.submit_answer($1::uuid, $2::uuid, $3)`,
      [attempt1Id, String(q0.question_id), firstAns]
    );
    assert.equal(sub0.rows[0]!.submit_answer.locked, true);
    assert.equal(sub0.rows[0]!.submit_answer.current_index, 1);

    // Going back to question 0 is impossible
    await assert.rejects(
      () =>
        execAsUser(db, CANDIDATE1_ID, `select public.get_question($1::uuid, 0)`, [attempt1Id]),
      /Navigation to question index 0 is forbidden; current unanswered index is 1/i
    );

    // Re-submitting an answer for question 0 is impossible
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.submit_answer($1::uuid, $2::uuid, 'B')`,
          [attempt1Id, String(q0.question_id)]
        ),
      /does not match the current active question index 1/i
    );

    // Simulate 15 minutes elapsed on server clock, then refresh (call start_exam / get_question)
    await db.exec(`
      BEGIN;
      select set_config('app.allow_exam_attempt_write', 'true', true);
      update public.exam_attempts set deadline_at = now() + interval '45 minutes' where id = '${attempt1Id}';
      COMMIT;
    `);

    const resumeRes = await execAsUser<{ start_exam: Record<string, unknown> }>(
      db,
      CANDIDATE1_ID,
      `select public.start_exam($1::uuid)`,
      [app1Id]
    );
    const resumed = resumeRes.rows[0]!.start_exam;
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.attempt_id, attempt1Id);
    assert.equal(resumed.current_index, 1);
    assert.ok(
      Number(resumed.remaining_seconds) >= 2695 && Number(resumed.remaining_seconds) <= 2700,
      `Expected ~2700s remaining after refresh, got ${resumed.remaining_seconds}`
    );
  });

  it("logs integrity events (tab_hidden, fullscreen_exit) and scores all 40 questions including numeric tolerance", async () => {
    // Log tab_hidden and fullscreen_exit events
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `select public.log_integrity_event($1::uuid, 'tab_hidden', '{"reason": "switched_tab"}'::jsonb)`,
      [attempt1Id]
    );
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `select public.log_integrity_event($1::uuid, 'fullscreen_exit', '{}'::jsonb)`,
      [attempt1Id]
    );

    const integrityCount = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from public.integrity_events where attempt_ref = $1::uuid`,
      [attempt1Id]
    );
    assert.equal(integrityCount.rows[0]?.cnt, 2);

    // Answer the remaining 39 questions (indices 1..39):
    // Make indices 0..29 correct (30/40 = 75.00%), and indices 30..39 wrong (10 wrong).
    // For numeric questions in 0..29, use '0.815' (within 0.80 ± 0.02 tolerance -> correct!).
    // For numeric questions in 30..39, use '0.85' (outside 0.80 ± 0.02 tolerance -> wrong!).
    let finalSubmitPayload: Record<string, unknown> | null = null;

    for (let idx = 1; idx < 40; idx++) {
      const qRes = await execAsUser<{ get_question: Record<string, unknown> }>(
        db,
        CANDIDATE1_ID,
        `select public.get_question($1::uuid)`,
        [attempt1Id]
      );
      const q = qRes.rows[0]!.get_question;
      assert.equal(q.question_index, idx);

      const shouldBeCorrect = idx < 30;
      const ans =
        q.type === "numeric"
          ? shouldBeCorrect
            ? "0.815"
            : "0.85"
          : shouldBeCorrect
            ? "A"
            : "D";

      const subRes = await execAsUser<{ submit_answer: Record<string, unknown> }>(
        db,
        CANDIDATE1_ID,
        `select public.submit_answer($1::uuid, $2::uuid, $3)`,
        [attempt1Id, String(q.question_id), ans]
      );
      finalSubmitPayload = subRes.rows[0]!.submit_answer;
    }

    assert.equal(finalSubmitPayload?.finished, true);
    const stageResult = finalSubmitPayload?.stage_result as Record<string, unknown>;
    assert.equal(Number(stageResult.raw_score), 30);
    assert.equal(Number(stageResult.percent), 75);
    assert.equal(stageResult.passed, true);

    // Verify application status automatically advanced to s2_passed
    const appAfter = await execAsUser<{ status: string }>(
      db,
      CANDIDATE1_ID,
      `select status from public.applications where id = $1::uuid`,
      [app1Id]
    );
    assert.equal(appAfter.rows[0]?.status, "s2_passed");
  });

  it("auto-submits at deadline when time expires mid-exam", async () => {
    // Candidate 2 starts exam
    const start2 = await execAsUser<{ start_exam: Record<string, unknown> }>(
      db,
      CANDIDATE2_ID,
      `select public.start_exam($1::uuid)`,
      [app2Id]
    );
    const attempt2Id = String(start2.rows[0]!.start_exam.attempt_id);

    // Candidate 2 answers 4 questions correctly before time runs out
    for (let idx = 0; idx < 4; idx++) {
      const qRes = await execAsUser<{ get_question: Record<string, unknown> }>(
        db,
        CANDIDATE2_ID,
        `select public.get_question($1::uuid)`,
        [attempt2Id]
      );
      const q = qRes.rows[0]!.get_question;
      const ans = q.type === "numeric" ? "0.80" : "A";
      await execAsUser(
        db,
        CANDIDATE2_ID,
        `select public.submit_answer($1::uuid, $2::uuid, $3)`,
        [attempt2Id, String(q.question_id), ans]
      );
    }

    // Grab question 4, then expire server deadline before Candidate 2 submits it
    const q4Res = await execAsUser<{ get_question: Record<string, unknown> }>(
      db,
      CANDIDATE2_ID,
      `select public.get_question($1::uuid)`,
      [attempt2Id]
    );
    const q4Id = String(q4Res.rows[0]!.get_question.question_id);

    await db.exec(`
      BEGIN;
      select set_config('app.allow_exam_attempt_write', 'true', true);
      update public.exam_attempts set deadline_at = now() - interval '2 seconds' where id = '${attempt2Id}';
      COMMIT;
    `);

    // Candidate 2 tries to submit after deadline -> rejected; attempt is auto-submitted via finish_exam
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE2_ID,
          `select public.submit_answer($1::uuid, $2::uuid, 'A')`,
          [attempt2Id, q4Id]
        ),
      /Exam deadline has passed; attempt has been auto-submitted/i
    );

    // Calling start_exam or finish_exam when deadline has passed auto-finalizes the timed_out attempt
    const fin2 = await execAsUser<{ finish_exam: Record<string, unknown> }>(
      db,
      CANDIDATE2_ID,
      `select to_jsonb(public.finish_exam($1::uuid)) as finish_exam`,
      [attempt2Id]
    );
    const sr2 = fin2.rows[0]!.finish_exam;
    assert.equal(Number(sr2.raw_score), 4);
    assert.equal(Number(sr2.percent), 10);
    assert.equal(sr2.passed, false);

    const app2After = await execAsUser<{ status: string }>(
      db,
      CANDIDATE2_ID,
      `select status from public.applications where id = $1::uuid`,
      [app2Id]
    );
    assert.equal(app2After.rows[0]?.status, "s2_failed");
  });

  it("validates and imports admin CSV questions while blocking non-admins", async () => {
    const csvSample = [
      "track,stage,domain,difficulty,type,stem,code_snippet,option_a,option_b,option_c,option_d,correct,tolerance,explanation",
      'ai,2,python_data,easy,mcq,"[FAKE SAMPLE CSV] Which method drops missing rows?",,dropna(),fillna(),isna(),merge(),A,0,dropna removes nulls',
      'ai,2,eval_debugging,hard,numeric,"[FAKE SAMPLE CSV] Compute harmonic mean of 0.5 and 0.5",,,,,,0.50,0.01,Exact 0.50',
    ].join("\n");

    const parsed = parseQuestionsCsv(csvSample);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.items?.length, 2);

    // Candidate cannot import questions
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.admin_import_questions($1::jsonb)`,
          [JSON.stringify(parsed.items)]
        ),
      /Only administrators can import questions/i
    );

    // Admin imports CSV questions
    const importRes = await execAsUser<{ admin_import_questions: number }>(
      db,
      ADMIN_ID,
      `select public.admin_import_questions($1::jsonb)`,
      [JSON.stringify(parsed.items)]
    );
    assert.equal(importRes.rows[0]?.admin_import_questions, 2);
  });
});
