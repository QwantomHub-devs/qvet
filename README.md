# Talent Vetting Platform

A single web platform that vets and certifies engineering talent across three tracks (**AI**, **IoT**, and **Robotics**) through five sequential stages:

0. **Stage 0:** Application & Identity Check (Gate)
1. **Stage 1:** Foundation Screen (15% weight, 60% minimum)
2. **Stage 2:** Technical Exam (25% weight, 60% minimum)
3. **Stage 3:** Practical Project (35% weight, 60% minimum + ≥40% per part)
4. **Stage 4:** Live Technical Defence (25% weight, minimum average 2.5 / 4.0)

Source-of-truth specifications live in [`/docs`](./docs):

- [`docs/platform-design.md`](./docs/platform-design.md)
- [`docs/blueprint-ai.md`](./docs/blueprint-ai.md)
- [`docs/blueprint-iot.md`](./docs/blueprint-iot.md)
- [`docs/blueprint-robotics.md`](./docs/blueprint-robotics.md)

---

## Repository Structure

```text
/
├── AGENTS.md                        # Engineering, security, and scope rules
├── README.md                        # Setup, environment variables, and test guide
├── .env.example                     # Environment variable template
├── docs/                            # Assessment blueprints and architecture design
├── supabase/                        # Supabase CLI configuration, migrations, seeds & SQL tests
│   ├── config.toml
│   ├── seed.sql
│   ├── migrations/
│   │   ├── 0001_m1_foundation.sql
│   │   ├── 0002_m2_exam_engine.sql
│   │   └── 0003_m3_stage1_and_reviews.sql
│   └── tests/
│       ├── m1_access_and_status.test.sql
│       ├── m2_exam_engine.test.sql
│       └── m3_stage1_and_reviews.test.sql
├── web/                             # Next.js (App Router, strict TypeScript, Tailwind CSS)
│   ├── src/
│   │   ├── actions/                 # Server Actions (Auth, Stage 0, Stage 1, Stage 2, Reviewer, Admin)
│   │   ├── app/                     # Next.js App Router pages
│   │   ├── components/              # Accessible, low-bandwidth UI components
│   │   └── lib/                     # Supabase clients, strict database types, validators
│   └── tests/                       # Automated unit & PostgreSQL 17 integration test suites
└── grader/                          # Python 3 Docker grader worker (introduced in M4)
```

---

## Prerequisites

- **Node.js** 20+ and **npm**
- **Docker** (running locally for the Supabase CLI stack)
- **Supabase CLI** (`npx supabase`)

---

## Local Development Setup

### 1. Start the Local Supabase Stack

From the repository root, start the local Supabase containers and apply all migrations + seed data cleanly:

```bash
npx supabase start
npx supabase db reset
```

### 2. Configure Environment Variables

Copy `.env.example` to `web/.env.local` and fill in the local keys printed by `npx supabase status`:

```bash
cp .env.example web/.env.local
```

| Variable                        | Scope           | Description                                                                                                                                     |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public          | Local Supabase API URL (`http://127.0.0.1:54321`)                                                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public          | Local Supabase anonymous/public JWT key                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only** | Used only on the server to issue 60-second signed ID URLs after `log_admin_id_view` writes to `audit_log`. Never exposed to the browser bundle. |
| `NEXT_PUBLIC_SITE_URL`          | Public          | Local web app origin (`http://localhost:3000`)                                                                                                  |

### 3. Install Dependencies & Run the Web App

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.
Local confirmation emails sent during registration can be viewed at the local Mailpit/Inbucket web interface (`http://127.0.0.1:54324`).

### 4. Seeded Test Accounts (`supabase/seed.sql`)

All seeded accounts use the password `Password123!`:

| Role        | Email                      | Notes                                                                     |
| ----------- | -------------------------- | ------------------------------------------------------------------------- |
| Admin       | `admin@vetting.local`      | Full access to `/admin` (ID verification, rubrics, questions, audit log)  |
| Reviewer 1  | `reviewer1@vetting.local`  | Attached to UNILAG (`blind` to candidate identities)                      |
| Reviewer 2  | `reviewer2@vetting.local`  | Attached to ABU (`blind` to candidate identities)                         |
| Reviewer 3  | `reviewer3@vetting.local`  | Attached to UNN (`blind` to candidate identities)                         |
| Reviewer 4  | `reviewer4@vetting.local`  | Attached to AltSchool Africa (`blind` to candidate identities)            |
| Candidate 1 | `candidate1@vetting.local` | Sample candidate (`Chinedu Okafor`, UNILAG)                               |
| Candidate 2 | `candidate2@vetting.local` | Sample candidate (`Amina Yusuf`, ABU)                                     |

---

## Testing & Verification

### 1. Database & RLS Tests (pgTAP)

Run the SQL test suite directly against local Postgres:

```bash
npx supabase test db
```

### 2. Type Check & Linting

```bash
cd web
npm run typecheck
npm run lint
```

### 3. Unit & Integration Tests (PostgreSQL 17 + Node Test Runner)

```bash
cd web
npm test
```

---

## Stage 1 Foundation Screen & Blind Review Engine (M3)

- **Part A — Written Explanation (40% of Stage 1 · 15 Minutes):** Draws a rotating prompt at random, autosaves every 10 seconds (`save_text_response`), locks at `deadline_at` or manual submit (`submit_text_response`), and automatically assigns 2 non-conflicting blind reviewers.
- **Part B — Recorded Video Scenario (30% of Stage 1 · 10 Minutes · Max 2-Min Clip):** Records in-browser at ~480p low bitrate via `MediaRecorder` with a file-upload fallback (`<= 25 MB` into private bucket `stage1-videos`), locks via `submit_video_response`, and assigns 2 non-conflicting blind reviewers.
- **Part C — Logic & Numeracy (30% of Stage 1 · 20 Minutes · 15 Questions):** Reuses the M2 exam engine (`start_exam(app_id, 1)`) across `logic_patterns` (5), `probability_numeracy` (5), and `charts_data` (5).
- **Blind Review & Automatic Third-Reviewer Rule (`/reviewer`):** Reviewers see only anonymous candidate identifiers (`CAND-...`), never candidate names or institutions, cannot be assigned work from their own institution, and cannot see peer reviewer scores until they submit their own review. If the first two reviewers' average scores differ by `> 1.0` point, a third blind reviewer is assigned automatically.

---

## Stage 2 Exam Engine & Admin CSV Question Import (M2)

- **Blueprint-Controlled Draw:** `start_exam(application_id)` draws 40 active questions for the AI Track matching the exact domain breakdown (`python_data`: 8, `stats_ml`: 10, `eval_debugging`: 8, `dl_nlp`: 4, `llm_apps`: 6, `eng_practice`: 4) and difficulty mix (40% easy = 16, 40% medium = 16, 20% hard = 8).
- **Server-Side Timer & Auto-Submit:** `deadline_at` is set on the server from `settings.timers.stage_2_minutes` (60 minutes). Refreshing `/exam` resumes at `current_index` with the exact remaining server time. Any call after `deadline_at` auto-submits and scores the attempt.
- **One Question at a Time & Answer Locking:** `get_question(attempt_id, index)` serves only the current unanswered question (`stem`, `code_snippet`, `options`) and never exposes `question_keys`. `submit_answer` locks the answer (`locked = true`) and advances `current_index`; going back or modifying a locked answer is rejected by database triggers and RPC checks.
- **Admin CSV Import (`/admin` -> Question Bank):** Admins can import questions and locked answer keys via CSV with headers:
  `track,stage,domain,difficulty,type,stem,code_snippet,option_a,option_b,option_c,option_d,correct,tolerance,explanation`

---

## Grader Worker (`grader/`)

The Python 3 Docker grader worker (`predictions` and `retrieval` graders) is scheduled for **Milestone 4 (M4)**, and the Judge0 CE sandbox is scheduled for **Milestone 7 (M7 - IoT Track)** per Section 10 of [`docs/platform-design.md`](./docs/platform-design.md).
