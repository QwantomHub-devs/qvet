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
| Grader      | `grader@vetting.local`     | Dedicated service worker account for claiming and grading worker jobs     |

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

## Stage 3 Practical Project & Grader Worker Engine (M4)

- **Scenario Delivery & Server-Side 5-Hour Timer:** `start_project(application_id)` provisions a scenario kit (`scenario-kits` private bucket) and initializes a server-enforced 5-hour countdown (`deadline_at = now() + interval '5 hours'`). Candidates download starter kits using short-lived signed URLs without any hidden evaluation test data.
- **Single Logged Pause:** Candidates can pause their attempt once (`pause_project`) for up to 30 minutes to accommodate power outages or connectivity breaks. A resume call (`resume_project`) extends the deadline by the exact paused duration and writes an audit log entry. Subsequent pause attempts are strictly rejected.
- **Deliverables & Size Limits:** Submissions per part (`predictions`, `retrieval`, `notebook`, `code`, `writeup`) are validated against server-enforced byte caps (`max_project_upload_bytes`) stored in `settings`:
  - `predictions`: 2 MB
  - `retrieval`: 5 MB
  - `notebook`: 10 MB
  - `code`: 5 MB
  - `writeup`: 5 MB
- **Practice Runs Queue (Max 10):** Candidates can trigger intermediate practice runs (`request_practice_run`) during the project window. Practice runs compute metrics on practice data to give immediate feedback without awarding final score points. A strict 10-run limit per attempt is enforced by Postgres triggers.
- **Grader Worker Engine (`grader/`):** A standalone, outbound-only Python 3 worker operating with zero external pip dependencies (standard library only).
  - Atomically claims queued jobs via `claim_next_job` using `FOR UPDATE SKIP LOCKED`.
  - Re-queues stalled jobs after 10 minutes (`requeue_stuck_jobs`).
  - Evaluates **Part A1 Predictions** using multi-class Macro-F1 with piecewise/linear point mapping (0–15 points).
  - Evaluates **Part B1 Retrieval** using Top-3 Hit Rate on knowledge base documents (0–15 points).
  - Evaluates **Part B3 Unanswerable Queries** measuring correct refusal detection (0–10 points).
  - Saves scores directly to `project_component_scores` via `save_job_result`.
- **Pass Thresholds:** Stage 3 requires a total of $\ge 60$ points out of 100, plus minimums of $\ge 16$ points out of 40 in Part A and $\ge 16$ points out of 40 in Part B.

### Running the Grader Worker

```bash
# In development/test mode:
python3 -m grader.worker

# To run with custom Supabase endpoints:
SUPABASE_URL="http://127.0.0.1:54321" \
GRADER_SERVICE_KEY="<service_role_or_grader_jwt>" \
python3 -m grader.worker
```

### Running Grader Unit Tests

```bash
python3 -m unittest discover -s grader/tests
```

### Generating Synthetic Fake Scenarios

To generate sample ticket and retrieval data for local testing (clearly marked `[FAKE SAMPLE - NOT REAL CONTENT]`):

```bash
python3 scripts/generate_fake_scenario.py
```

---

## Results, Credentials & Stage 4 Live Defence (M5)

- **Stage 4 Booking & Video Call (`/defence`):** Candidates who pass Stage 3 schedule a 40-minute live technical defence (`book_stage4_defence`) with a stored external video call link (Google Meet / Jitsi).
- **Reviewer Conflict Prevention (Rule 10):** Reviewers are automatically screened; a reviewer cannot be assigned a candidate from their own institution.
- **Five-Criterion Rubric Scoring (`/reviewer`):** Reviewers evaluate the interview across five dimensions (scored 1 to 4):
  1. `understanding_own_work`: Rationale behind architecture and code. A score of 1 is an automatic fail signal for borrowed or unexplained code.
  2. `fundamentals_depth`: Mastery of core machine learning and engineering concepts.
  3. `live_problem_solving`: Adapting to a live prompt modification and reasoning aloud.
  4. `communication`: Clarity, conciseness, and active listening.
  5. `honesty_professionalism`: Candor about limitations and verification steps.
- **Stage 4 Passing Requirements:** Average score $\ge 2.50 / 4.00$ and `understanding_own_work > 1`. Percentage conversion: `((avg - 1) / 3) * 100`.
- **`compute_overall(application_id)`:** Evaluates overall weighted score:
  $$\text{overall} = 0.15 \times \text{Stage 1} + 0.25 \times \text{Stage 2} + 0.35 \times \text{Stage 3} + 0.25 \times \text{Stage 4}$$
  - Enforces all stage minimums ($\ge 60\%$ in Stages 1–3, $\ge 2.50$ avg in Stage 4). If any stage minimum is not met, certification is denied.
  - Tiers:
    - **Elite:** Overall $\ge 90$ and Stage 4 average $\ge 3.50$.
    - **Certified Pro:** Overall $\ge 80$ and Stage 3 score $\ge 75$.
    - **Certified:** Overall $\ge 70$ with all stage minimums met.
- **Admin Approval & Credential Issuance:** Admins approve credentials in `/admin`, generating a cryptographically random, unguessable `verify_code` (e.g. `VET-K8J2-M9N4`) valid for 24 months, and advancing status to `certified`.
- **Public Verification (`/verify/[code]`):** Publicly accessible endpoint that strictly returns *only* candidate full name, track, tier, issued/expiry dates, and validity status (`valid`, `revoked`, `expired`). **Zero PII leakage** (no candidate email, phone, institution, or raw question answers).
- **Employer Scorecard (`/scorecard/[code]`):** Comprehensive scorecard displaying tier, overall score, Stage 2 technical exam domain breakdown, Stage 3 practical project metrics, communication rating, and senior reviewer appraisal.

---

## Security Audit & Hardening (Milestones 1–5 Review)

A comprehensive security audit and penetration review was conducted across 8 security vectors, resulting in automated attack tests (`web/tests/security-audit.test.ts`) and hardening migration `0006_security_hardening.sql`:

- **Confidentiality & Access Control (RLS):**
  - All 27 tables have Row Level Security enabled and forced (`FORCE ROW LEVEL SECURITY`).
  - Answer keys (`question_keys`), hidden evaluation datasets (`scenario-hidden`), and internal grader queues (`grading_jobs`) are strictly isolated from candidates.
  - Reviewer access to project submissions and storage is strictly scoped to explicitly assigned reviews or Stage 4 defence bookings (Rule 10 blind review separation).
- **Integrity Event Quota Protection:** `public.log_integrity_event` enforces a quota limit of 100 events per exam attempt to prevent database storage exhaustion on Supabase free-tier limits.
- **Application-Level Rate Limiting:** In-memory sliding-window rate limiters protect registration (`signUpAction`), login (`signInAction`), and public credential verification (`/verify/[code]`).
- **Binary Magic-Byte Inspection:** Upload endpoints validate binary headers (JPEG, PNG, WebP, PDF, WebM, MP4) rather than relying solely on client-provided MIME strings.
- **Penetration Test Suite:** Automated attack simulations cover 22 attack scenarios (`npm --prefix web test`), verifying RLS enforcement, status/score immutability, and blind reviewer isolation.
