# AGENTS.md: Talent Vetting Platform

Read this file fully before every task. It overrides your defaults.

## 1. What this project is

A single web platform that vets and certifies talent in three tracks (AI, IoT, Robotics) through five stages: identity, Foundation screen, Technical exam, Practical project, Live defence. It issues a scored, publicly verifiable credential.

Everything is specified in `/docs`. Treat those documents as the source of truth:

- `/docs/platform-design.md` : architecture, data model, access rules, build order
- `/docs/blueprint-ai.md`, `/docs/blueprint-iot.md`, `/docs/blueprint-robotics.md` : stages, weights, scoring, rubrics

If the code and the docs disagree, or the docs are unclear or silent, **stop and ask**. Do not invent scoring rules, thresholds or stage logic.

## 2. Stack (do not substitute without asking)

- Frontend: Next.js (App Router), TypeScript (strict), Tailwind CSS
- Backend: Supabase (Postgres, Auth, Storage, Row Level Security, Edge Functions only when SQL cannot do the job)
- Business rules: Postgres functions (exam draw, answer saving, scoring, status changes)
- Grader worker: Python 3 in Docker, polls the database for jobs (outbound connections only)
- Sandbox for untrusted code: Judge0 CE (introduced at the IoT milestone, not before)
- Local development: Supabase CLI with local Docker. Never develop against the production project.

## 3. Non-negotiable rules

1. **Server decides, browser displays.** Timers, deadlines, scores, correct answers and status changes are computed on the server only.
2. **Row Level Security on every table, deny by default.** No table is created without policies in the same migration.
3. Candidates can never read `question_keys`, hidden test data, grader detail results, or reviewer comments. Candidates can never write `status`, `score`, `deadline_at` or `is_correct`.
4. **All status changes go through one function, `advance_status`**, which validates the transition and writes to `audit_log`.
5. **Every schema change is a numbered migration** in `supabase/migrations`. The whole database must be rebuildable from migrations plus seed data.
6. **Secrets:** never commit secrets. Provide `.env.example`. The Supabase service-role key must never reach the browser bundle.
7. **Untrusted code** (candidate submissions) runs only inside the sandbox, with no network and strict CPU, memory and time limits. Never execute it on the host that holds database credentials.
8. **Personal data:** ID documents, videos and uploads live in private storage, accessed through short-lived signed URLs. Log every admin read of an ID document. Collect only what the docs specify.
9. **Configuration, not constants:** stage weights, pass marks, tier thresholds, retake wait, run limits and timers live in a `settings` table and are read at runtime. The numbers in the blueprints are starting values and will change after the pilot.
10. Reviewers see work **blind**: no candidate name or institution. A reviewer cannot be assigned work from their own institution.

## 4. Scope discipline

- Build **one milestone at a time**, in the order in section 10 of the platform design doc (M1, M2, ...). Do not start a milestone until I approve the previous one.
- Do **not** build anything in the doc's "What not to build in v1" list (own video calls, in-browser code editor, payments, employer marketplace, AI auto-scoring of written or video answers, mobile apps).
- Do not add libraries or services that cost money or need paid plans without asking first.
- Prefer boring, well-known solutions. Fewer dependencies is better.

## 5. How to work

1. **Plan first.** For each milestone, produce an implementation plan: files to create or change, tables and functions, risks, and open questions. Wait for my approval before writing code.
2. State your assumptions explicitly. If more than two things are ambiguous, ask me before building.
3. Work in small steps with clear commit messages. One logical change per commit.
4. When finishing a milestone, give me: a summary of what was built, how to run it locally, how to test it, what is **not** done or not tested, and anything you were unsure about.
5. Keep `README.md` current: setup steps, environment variables, how to run the app, database and grader.
6. Never claim something works unless you ran it. Say "not verified" when you did not.

## 6. Testing requirements

- **Scoring math:** unit tests using worked examples. For instance, overall = 0.15 x Stage1 + 0.25 x Stage2 + 0.35 x Stage3 + 0.25 x Stage4, with per-stage minimums and tier thresholds. Include edge cases (one stage just below its minimum, a score exactly on a threshold).
- **Access rules:** automated tests proving that candidate A cannot read candidate B's data, candidates cannot read answer keys or hidden data, a reviewer cannot see names, and a reviewer cannot get same-institution work.
- **Exam engine:** tests for random draw matching the blueprint distribution, timer enforced server-side, refresh resumes at the right question with the right remaining time, answer locking, auto-submit at deadline.
- **Status machine:** tests that illegal transitions are rejected.
- Run linting and type checks before declaring any task finished.

## 7. Product and UX rules

- Many users will have slow, unreliable connections and power cuts. Design for low bandwidth, small payloads, autosave, and resumable sessions.
- Responsive web app that works well on a basic laptop and acceptably on a phone.
- Plain, simple English in all user-facing text. No idioms.
- Accessible by default: labels, keyboard navigation, sufficient contrast.
- Show clear errors and clear time remaining. Never lose a candidate's work silently.

## 8. Free-tier awareness

The project starts on free tiers (small database, limited file storage, a free-plan database that can pause when idle). So:

- Cap upload sizes (video about 25 MB, project files as the docs specify) and enforce them on the server.
- Add cleanup jobs for expired uploads as the docs describe.
- Add a simple scheduled keep-alive and a weekly data export script.
- Avoid storing large binary data in the database.

## 9. Definition of done (for any task)

- Code compiles, lints and passes type checks
- Tests written and passing
- Migrations apply cleanly on a fresh local database
- Access rules tested
- README updated
- Summary delivered with known gaps listed honestly
