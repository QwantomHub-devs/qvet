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
const REVIEWER1_ID = "00000000-0000-0000-0000-000000000002";
const CANDIDATE1_ID = "00000000-0000-0000-0000-000000000004";
const CANDIDATE2_ID = "00000000-0000-0000-0000-000000000005";

/**
 * Runs a SQL statement block inside a transaction as a specific authenticated user,
 * matching Supabase PostgREST's exact JWT & role context.
 */
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

describe("M1 Database Migration, RLS Access Rules, Private Storage, Audit Log & Status Machine", () => {
  let db: PGlite;

  before(async () => {
    db = await PGlite.create({
      extensions: { pgcrypto },
    });

    // 1. Bootstrap Supabase auth & storage base schemas
    await db.exec(SUPABASE_BASE_BOOTSTRAP_SQL);

    // 2. Apply 0001_m1_foundation.sql migration from disk
    const migrationSql = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/0001_m1_foundation.sql"),
      "utf8"
    );
    await db.exec(migrationSql);

    // 3. Apply seed.sql from disk
    const seedSql = fs.readFileSync(path.join(REPO_ROOT, "supabase/seed.sql"), "utf8");
    await db.exec(seedSql);
  });

  after(async () => {
    await db.close();
  });

  it("rebuilds cleanly from migrations + seed data and enables RLS on all 7 M1 tables", async () => {
    const rlsCheck = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('settings', 'institutions', 'cohorts', 'profiles', 'applications', 'id_documents', 'audit_log')
       order by c.relname`
    );

    assert.equal(rlsCheck.rows.length, 7);
    for (const row of rlsCheck.rows) {
      assert.equal(row.relrowsecurity, true, `Expected RLS enabled on ${row.relname}`);
    }

    const settingsCount = await db.query<{ count: string }>(
      `select count(*)::text as count from public.settings`
    );
    assert.equal(Number(settingsCount.rows[0]?.count), 9);
  });

  it("allows Candidate 1 to submit Stage 0 onboarding and rejects duplicate phone, duplicate GitHub, or second track", async () => {
    const { rows } = await execAsUser<{ status: string; current_stage: number; id: string }>(
      db,
      CANDIDATE1_ID,
      `select id, status, current_stage from public.submit_onboarding(
        'Chinedu Okafor',
        'Nigeria',
        '+234 803 111 2222',
        'https://github.com/chinedu-okafor',
        2.5,
        'Python data cleaning, scikit-learn, and RAG evaluation',
        'Africa/Lagos',
        25,
        '11111111-1111-1111-1111-111111111101'::uuid,
        null,
        'ai',
        '22222222-2222-2222-2222-222222222201'::uuid,
        '{}'::jsonb,
        true
      )`
    );

    assert.equal(rows[0]?.status, "registered");
    assert.equal(rows[0]?.current_stage, 0);

    // Rejects second application from the same candidate
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.submit_onboarding(
            'Chinedu Okafor',
            'Nigeria',
            '+234 803 111 2222',
            'https://github.com/chinedu-okafor',
            2.5,
            'IoT firmware',
            'Africa/Lagos',
            25,
            '11111111-1111-1111-1111-111111111101'::uuid,
            null,
            'iot',
            null,
            '{}'::jsonb,
            true
          )`
        ),
      /already have an active application/i
    );

    // Rejects duplicate phone number from Candidate 2
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE2_ID,
          `select public.submit_onboarding(
            'Amina Yusuf',
            'Nigeria',
            '+234-803-111-2222',
            'https://github.com/amina-yusuf',
            3.0,
            'ESP32, C++, MQTT',
            'Africa/Lagos',
            30,
            null,
            'Independent Embedded Lab Kano',
            'iot',
            null,
            '{"boards_used": ["ESP32"]}'::jsonb,
            true
          )`
        ),
      /Duplicate account detected.*phone/i
    );

    // Rejects duplicate GitHub URL from Candidate 2
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE2_ID,
          `select public.submit_onboarding(
            'Amina Yusuf',
            'Nigeria',
            '+234 809 999 8888',
            'HTTPS://github.com/chinedu-okafor/',
            3.0,
            'ESP32, C++, MQTT',
            'Africa/Lagos',
            30,
            null,
            'Independent Embedded Lab Kano',
            'iot',
            null,
            '{"boards_used": ["ESP32"]}'::jsonb,
            true
          )`
        ),
      /Duplicate account detected.*GitHub/i
    );

    // Candidate 2 succeeds with unique phone and GitHub + Other/Independent institution
    const c2Res = await execAsUser<{ status: string }>(
      db,
      CANDIDATE2_ID,
      `select status from public.submit_onboarding(
        'Amina Yusuf',
        'Nigeria',
        '+234 809 999 8888',
        'https://github.com/amina-yusuf',
        3.0,
        'ESP32, C++, MQTT',
        'Africa/Lagos',
        30,
        null,
        'Independent Embedded Lab Kano',
        'iot',
        null,
        '{"boards_used": ["ESP32"]}'::jsonb,
        true
      )`
    );
    assert.equal(c2Res.rows[0]?.status, "registered");
  });

  it("proves a candidate cannot read another candidate's data and a reviewer cannot see candidate profiles", async () => {
    // Candidate 2 queries profiles -> sees only own profile, never Candidate 1
    const c2Profiles = await execAsUser<{ user_id: string }>(
      db,
      CANDIDATE2_ID,
      `select user_id from public.profiles`
    );
    assert.equal(c2Profiles.rows.length, 1);
    assert.equal(c2Profiles.rows[0]?.user_id, CANDIDATE2_ID);

    // Candidate 2 queries applications -> sees only own application, never Candidate 1
    const c2Apps = await execAsUser<{ user_id: string }>(
      db,
      CANDIDATE2_ID,
      `select user_id from public.applications`
    );
    assert.equal(c2Apps.rows.length, 1);
    assert.equal(c2Apps.rows[0]?.user_id, CANDIDATE2_ID);

    // Candidate 2 cannot read audit_log
    const c2Audit = await execAsUser(db, CANDIDATE2_ID, `select * from public.audit_log`);
    assert.equal(c2Audit.rows.length, 0);

    // Reviewer 1 cannot read any candidate profiles or applications (blind review rule)
    const revCandidateProfiles = await execAsUser(
      db,
      REVIEWER1_ID,
      `select * from public.profiles where role = 'candidate'`
    );
    assert.equal(revCandidateProfiles.rows.length, 0);

    const revApps = await execAsUser(db, REVIEWER1_ID, `select * from public.applications`);
    assert.equal(revApps.rows.length, 0);
  });

  it("proves a candidate cannot write status, score, or role", async () => {
    // 1. Candidate cannot escalate role to admin
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `update public.profiles set role = 'admin' where user_id = auth.uid()`
        ),
      /Insufficient privilege to change user role/i
    );

    // 2. Candidate cannot directly UPDATE application status or score (blocked by RLS + trigger)
    const directUpdate = await execAsUser<{ id: string }>(
      db,
      CANDIDATE1_ID,
      `update public.applications set status = 'approved', score = 95.0 where user_id = auth.uid() returning id`
    );
    assert.equal(directUpdate.rows.length, 0);

    // Verify application status is still 'registered' and score is still null
    const verifyApp = await execAsUser<{ status: string; score: number | null }>(
      db,
      CANDIDATE1_ID,
      `select status, score from public.applications where user_id = auth.uid()`
    );
    assert.equal(verifyApp.rows[0]?.status, "registered");
    assert.equal(verifyApp.rows[0]?.score, null);

    // 3. Candidate cannot call advance_status directly
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.advance_status(
            (select id from public.applications where user_id = auth.uid()),
            'id_pending',
            'Direct call attempt'
          )`
        ),
      /Candidates and reviewers cannot call advance_status directly/i
    );
  });

  it("enforces private storage RLS, logs admin ID reads, rejects illegal status transitions, and approves candidate ID", async () => {
    const app1Res = await execAsUser<{ id: string }>(
      db,
      CANDIDATE1_ID,
      `select id from public.applications where user_id = auth.uid()`
    );
    const app1Id = app1Res.rows[0]!.id;
    const storagePath = `${CANDIDATE1_ID}/${app1Id}/nin-card.pdf`;

    // Candidate 2 cannot upload into Candidate 1's storage folder
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE2_ID,
          `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
          [storagePath]
        ),
      /row-level security policy/i
    );

    // Candidate 1 uploads into their own storage folder in private bucket 'id-documents'
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
      [storagePath]
    );

    // Candidate 1 cannot record an ID upload if name_on_id does not match profile.full_name
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.record_id_upload($1::uuid, $2, 204800, 'application/pdf', 'NIN-12345678901', 'Someone Else')`,
          [app1Id, storagePath]
        ),
      /does not match your registered full name/i
    );

    // Candidate 1 records valid ID upload -> status transitions to id_pending
    const docRes = await execAsUser<{ id: string }>(
      db,
      CANDIDATE1_ID,
      `select id from public.record_id_upload($1::uuid, $2, 204800, 'application/pdf', 'NIN-12345678901', 'Chinedu Okafor')`,
      [app1Id, storagePath]
    );
    const docId = docRes.rows[0]!.id;

    // Candidate 2 cannot reuse Candidate 1's government ID number
    const app2Res = await execAsUser<{ id: string }>(
      db,
      CANDIDATE2_ID,
      `select id from public.applications where user_id = auth.uid()`
    );
    const app2Id = app2Res.rows[0]!.id;
    const c2Path = `${CANDIDATE2_ID}/${app2Id}/id.png`;
    await execAsUser(
      db,
      CANDIDATE2_ID,
      `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
      [c2Path]
    );
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE2_ID,
          `select public.record_id_upload($1::uuid, $2, 150000, 'image/png', 'nin 12345678901', 'Amina Yusuf')`,
          [app2Id, c2Path]
        ),
      /Duplicate account detected.*government ID/i
    );

    // Illegal status transitions are rejected even when called by Admin
    await assert.rejects(
      () =>
        execAsUser(
          db,
          ADMIN_ID,
          `select public.advance_status($1::uuid, 's1_open', 'Trying to skip ID approval')`,
          [app1Id]
        ),
      /Illegal status transition from id_pending to s1_open/i
    );

    await assert.rejects(
      () =>
        execAsUser(
          db,
          ADMIN_ID,
          `select public.advance_status($1::uuid, 'certified', 'Trying to jump straight to certified')`,
          [app1Id]
        ),
      /Illegal status transition from id_pending to certified/i
    );

    await assert.rejects(
      () =>
        execAsUser(
          db,
          ADMIN_ID,
          `select public.advance_status($1::uuid, 'approved', 'Trying to approve before ID upload')`,
          [app2Id]
        ),
      /Illegal status transition from registered to approved/i
    );

    // Non-admin cannot call log_admin_id_view
    await assert.rejects(
      () =>
        execAsUser(
          db,
          CANDIDATE1_ID,
          `select public.log_admin_id_view($1::uuid)`,
          [docId]
        ),
      /Only administrators can view ID documents/i
    );

    // Admin views ID document -> returns storage_path and logs to audit_log
    const viewRes = await execAsUser<{ log_admin_id_view: string }>(
      db,
      ADMIN_ID,
      `select public.log_admin_id_view($1::uuid)`,
      [docId]
    );
    assert.equal(viewRes.rows[0]?.log_admin_id_view, storagePath);

    const viewAudit = await execAsUser<{ action: string; actor: string }>(
      db,
      ADMIN_ID,
      `select action, actor from public.audit_log where action = 'id_document_viewed' and entity_id = $1::uuid`,
      [docId]
    );
    assert.equal(viewAudit.rows.length, 1);
    assert.equal(viewAudit.rows[0]?.actor, ADMIN_ID);

    // Test rejection -> candidate re-upload -> admin approval flow
    const rejectRes = await execAsUser<{ status: string }>(
      db,
      ADMIN_ID,
      `select status from public.admin_verify_id($1::uuid, 'rejected', 'Image corners were cut off')`,
      [app1Id]
    );
    assert.equal(rejectRes.rows[0]?.status, "rejected");

    const newStoragePath = `${CANDIDATE1_ID}/${app1Id}/nin-card-clear.pdf`;
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `insert into storage.objects (bucket_id, name) values ('id-documents', $1)`,
      [newStoragePath]
    );
    await execAsUser(
      db,
      CANDIDATE1_ID,
      `select public.record_id_upload($1::uuid, $2, 240000, 'application/pdf', 'NIN-12345678901', 'Chinedu Okafor')`,
      [app1Id, newStoragePath]
    );

    const pendingAgain = await execAsUser<{ status: string }>(
      db,
      CANDIDATE1_ID,
      `select status from public.applications where id = $1::uuid`,
      [app1Id]
    );
    assert.equal(pendingAgain.rows[0]?.status, "id_pending");

    // Admin approves -> status becomes `approved` and current_stage auto-advances to 1
    const approveRes = await execAsUser<{ status: string; current_stage: number }>(
      db,
      ADMIN_ID,
      `select status, current_stage from public.admin_verify_id($1::uuid, 'approved', 'Clear government ID verified')`,
      [app1Id]
    );
    assert.equal(approveRes.rows[0]?.status, "approved");
    assert.equal(approveRes.rows[0]?.current_stage, 1);

    // Verify audit_log is immutable (cannot be updated or deleted even by superuser/admin)
    await assert.rejects(
      () => db.exec(`delete from public.audit_log`),
      /audit_log is immutable/i
    );
  });
});
