# Talent Vetting Platform: Design and Implementation Plan

Version 1.0 · One platform that runs every stage of the AI, IoT and Robotics blueprints · Built to cost close to nothing at pilot scale

## 1. What we are building, in one paragraph

A single web application where a candidate signs up, verifies identity, takes the Foundation screen and the Technical exam, completes the Practical project, books and takes the Live defence, and receives a scored credential that an employer can verify online. Reviewers score the human-judged parts in the same application. An admin manages questions, scenarios, cohorts and results. Nothing happens outside the platform except the live video call itself.

**Design principles**

1. **Boring and small.** Use one managed backend and one small grader. Few moving parts means fewer things break.
2. **Server decides, browser displays.** Timers, scoring and correct answers live on the server. The browser is never trusted.
3. **Grade by submitted result where possible.** Asking candidates to submit predictions or output files and scoring them against hidden answers needs no code sandbox at all, which is the cheapest and safest approach.
4. **Pull, don't expose.** The grader fetches jobs from the database. It needs no public address, so it can run on your own computer at first.
5. **Build the AI track first, end to end.** It needs the least infrastructure. IoT and Robotics reuse everything and add only a harness each.

## 2. High-level view

### 2.1 Users and what each can do

| Role | Main actions |
| --- | --- |
| Candidate | Register, upload ID, take stages in order, download project kit, submit work, book the defence, view results and credential |
| Reviewer | See assigned submissions (blind to name and institution), score against rubrics, run live defences |
| Admin (you) | Manage question bank, scenarios and cohorts; assign reviewers; approve final credentials; view analytics and audit log |
| Partner institution (later) | See anonymised cohort results for its own students |
| Employer (later) | Verify a credential by code; later, search the certified pool |

### 2.2 Modules

| # | Module | What it does |
| --- | --- | --- |
| 1 | Onboarding and identity | Account, track choice, consent, ID upload, manual approval |
| 2 | Exam engine | Draws questions per blueprint, enforces the timer, scores automatically |
| 3 | Written and video responses | Collects Stage 1 text and short video answers |
| 4 | Project workspace | Delivers the scenario kit, accepts submissions, queues grading |
| 5 | Grader worker | Scores submissions against hidden data or inside a sandbox |
| 6 | Review console | Blind scoring with rubrics, double-scoring, third-reviewer rule |
| 7 | Scoring and credentials | Weighted overall score, tier, scorecard, public verification page |
| 8 | Admin console | Question bank, scenarios, cohorts, reviewer assignment, analytics |
| 9 | Integrity and audit | Tab-focus log, submission history, every status change recorded |
| 10 | Notifications | Emails for approval, deadlines, results |

### 2.3 Architecture

```mermaid
  Candidate / Reviewer / Admin browsers
                 |
         Web app (Next.js)  ---- hosted on a free static/edge host
                 |
      +----------+-----------------------------+
      |        Supabase (managed)              |
      |  Postgres (data + scoring functions)   |
      |  Auth (login, roles)                   |
      |  Storage (ID photos, videos, uploads)  |
      |  Row Level Security (who sees what)    |
      +----------+-----------------------------+
                 ^
                 | polls for jobs, writes scores (outbound only)
                 |
        Grader worker (Python, Docker)
           - scores prediction files
           - runs candidate code in a sandbox (Judge0)
           - runs IoT and Robotics harnesses
```

The only component with real operating risk is the grader's code sandbox, and you only need it for IoT and Robotics.

### 2.4 Candidate journey and status flow

| Status | Meaning | Moves to |
| --- | --- | --- |
| `registered` | Account created | `id_pending` |
| `id_pending` | ID uploaded, awaiting admin check | `approved` or `rejected` |
| `approved` | Can start Stage 1 | `s1_open` |
| `s1_open` | Stage 1 in progress | `s1_passed` or `s1_failed` |
| `s1_passed` | Unlocks Stage 2 | `s2_open` |
| `s2_open` / `s2_passed` / `s2_failed` | Exam | Same pattern |
| `s3_open` / `s3_grading` / `s3_review` / `s3_passed` / `s3_failed` | Practical | Same pattern, with grading and review states |
| `s4_scheduled` / `s4_done` / `s4_passed` / `s4_failed` | Live defence | Scored by reviewer |
| `certified` | Tier issued | `expired` after 24 months |
| `retake_wait` | Failed a stage; waiting 60 days | Back to the failed stage |

Only the server changes status, using one function (`advance_status`) that checks the rule and writes to the audit log.

## 3. The honest cost picture

"Costless" holds for most of the system at pilot size, but not everything. Figures below are from published 2026 pricing guides; check the provider's own pricing page before you rely on them.

| Piece | Free option | Limits to know | When you might pay |
| --- | --- | --- | --- |
| Database, login, file storage | Supabase free plan | About 500 MB database, 1 GB file storage, 50,000 monthly active users, 2 projects; the project **pauses after a week of inactivity** | When you need always-on, backups, or more storage (their paid plan starts around $25 a month) |
| Web hosting | A free static or edge host (for example Cloudflare Pages or Netlify) | Check the terms for commercial use before launch | Rarely at this scale |
| Code sandbox | Judge0 CE, open source and free to self-host | You need a machine that runs Docker; it is not zero-cost if you rent a server | A small server once you pass pilot scale |
| Grader worker | Your own computer or an old laptop, with a stable connection and power | Power cuts and sleep mode will stall grading; fine for a pilot of 20 to 30 people | A small always-on server |
| Live defence video | A free meeting tool (Jitsi or Google Meet) | Recording may be limited; see section 8 | Rarely |
| Email | A free tier of an email provider | Daily and monthly sending caps | At larger cohorts |

**Two things that will bite if you ignore them:** (1) keep the Supabase project active, for example with a scheduled weekly ping, and export your data every week because the free plan does not include daily backups; (2) candidate videos and ID photos fill 1 GB quickly, so set strict size limits and auto-delete rules (section 8).

## 4. Recommended tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js (React) with TypeScript, Tailwind CSS | Huge community, easy to find help, works well with Supabase |
| Backend | Supabase: Postgres, Auth, Storage, Row Level Security, Edge Functions | Replaces writing your own API, login and file handling |
| Business logic | Postgres functions for exam draw, answer saving and scoring; Edge Functions only for things the database cannot do | Keeps rules in one place and close to the data |
| Grader | Python 3 worker in Docker, using Supabase's client library | Python suits scoring and the simulators |
| Sandbox | Judge0 CE in Docker (needed from the IoT track onward) | Purpose-built for running untrusted code with CPU, memory and time limits |
| Video calls | External link (Jitsi or Google Meet) stored on the defence booking | Never build video yourself |
| Source control and deploy | GitHub plus automatic deploys from the host | Free and standard |

If you prefer a different frontend framework, nothing below depends on Next.js. The data model and grader do not change.

## 5. Low-level design

### 5.1 Data model

All tables have `id`, `created_at`, `updated_at`. Key columns only are listed.

| Table | Purpose and key columns |
| --- | --- |
| `profiles` | One per user: `user_id`, `role` (candidate, reviewer, admin), `full_name`, `country`, `institution_id` |
| `institutions` | `name`, `country`, `partner_code` |
| `cohorts` | `name`, `institution_id`, `track`, `opens_at`, `closes_at` |
| `applications` | A candidate in a track: `user_id`, `track` (ai, iot, robotics), `cohort_id`, `status`, `current_stage`, `consent_at` |
| `id_documents` | `application_id`, `storage_path`, `verified_by`, `verified_at` (private storage, admin-only) |
| `questions` | `track`, `domain`, `difficulty`, `type`, `stem`, `options` (JSON), `tolerance` for numeric items, `active`, `times_used`, `times_correct` |
| `question_keys` | `question_id`, `correct` (separate table, no access for candidates) |
| `exam_blueprints` | `track`, `domain`, `count`, `easy_pct`, `medium_pct`, `hard_pct` |
| `exam_attempts` | `application_id`, `started_at`, `deadline_at`, `question_ids` (the drawn list), `score`, `status` |
| `exam_answers` | `attempt_id`, `question_id`, `answer`, `answered_at`, `is_correct` |
| `prompts` | Stage 1 written and video prompts, rotated |
| `responses` | `application_id`, `prompt_id`, `kind` (text or video), `text`, `storage_path`, `submitted_at` |
| `scenarios` | `track`, `version`, `kit_path`, `config` (JSON: parameters, seeds), `active` |
| `project_attempts` | `application_id`, `scenario_id`, `started_at`, `deadline_at`, `runs_used`, `runs_allowed`, `status` |
| `submissions` | `attempt_id`, `part` (A, B, C, writeup), `file_path`, `submitted_at`, `is_final` |
| `grading_jobs` | `submission_id`, `kind`, `status` (queued, running, done, failed), `result` (JSON), `started_at`, `finished_at`, `worker_id` |
| `rubrics` and `rubric_criteria` | `stage`, `track`, `criterion`, `scale_min`, `scale_max`, `anchors` (the descriptions for scores 1 to 4) |
| `review_assignments` | `response_or_submission_ref`, `reviewer_id`, `due_at`, `status`, `is_second_review` |
| `review_scores` | `assignment_id`, `criterion_id`, `score`, `comment` |
| `stage_results` | `application_id`, `stage`, `raw_score`, `percent`, `passed`, `details` (JSON) |
| `credentials` | `application_id`, `tier`, `overall`, `issued_at`, `expires_at`, `verify_code`, `revoked` |
| `integrity_events` | `attempt_ref`, `type` (tab\_hidden, fullscreen\_exit, flagged\_similarity, late\_paste), `at`, `meta` |
| `audit_log` | `actor`, `action`, `entity`, `before`, `after`, `at` |

### 5.2 Access rules (Row Level Security)

This is where the platform's integrity lives, so write these first.

- A candidate can read only their own application, attempts, responses, results and credential.
- `question_keys`, hidden test data, grading results details and reviewer comments are never readable by candidates.
- Reviewers see only items assigned to them, with name and institution hidden (the review screen reads from a view that strips them).
- A reviewer cannot be assigned an item from their own institution.
- Admins can read everything. Every admin read of an ID document is logged.
- Candidates cannot write to `status`, `score` or `deadline_at`. Only server functions do.
- Credentials are readable by anyone through a public function that takes a `verify_code` and returns only: name, track, tier, date, valid or revoked.

### 5.3 Exam engine

1. **Start:** a function `start_exam(application_id)` checks the status is `s2_open`, then reads `exam_blueprints` and draws the required number of active questions per domain and difficulty at random, writes the list into `exam_attempts.question_ids`, and sets `deadline_at = now() + 60 minutes`.
2. **Serve:** `get_question(attempt_id, index)` returns only the stem and options for that index. It refuses if the deadline has passed or if the index is not the next unanswered one.
3. **Answer:** `submit_answer(attempt_id, question_id, answer)` stores the answer and marks it locked. No going back.
4. **Finish:** `finish_exam(attempt_id)` or an automatic job at the deadline scores all answers against `question_keys` (numeric items within tolerance), writes `stage_results`, updates question statistics, and calls `advance_status`.
5. **Integrity:** the browser reports tab-hidden and fullscreen-exit events to `integrity_events`. These only flag; they never fail a candidate by themselves.
6. **Power or connection loss:** because the timer is on the server, a candidate who reconnects resumes at the same question with the remaining time. A logged pause is not available in the exam (it is only 60 minutes); allow one admin-approved reset for documented outages.

### 5.4 Stage 1 responses

- Text answer: a textbox with word counter, autosave every 10 seconds, locked at deadline.
- Video answer: record in the browser using the standard media recording interface, limited to 2 minutes and a low resolution (about 480p) so a file is roughly 10 to 25 MB. Upload to private storage. If the browser cannot record, allow an upload of a short file.
- The logic items reuse the exam engine with their own blueprint.
- Parts A and B are sent to two reviewers through `review_assignments`.

### 5.5 Project workspace and submissions

For v1, **candidates work on their own machine** and upload files. Do not build an in-browser code editor yet; it is a large feature and not essential to prove the credential.

1. **Start:** `start_project(application_id)` assigns an active scenario at random, creates the attempt with a 5-hour `deadline_at`, and returns a time-limited download link to the scenario kit (instructions, starter files, practice data). Hidden data is never in the kit.
2. **Pause:** one 30-minute pause per attempt, started by the candidate, logged, extending the deadline.
3. **Submit:** `submissions` accepts files (size-capped) per part. The browser uploads straight to storage, then calls a function that checks the deadline and records the submission.
4. **Practice runs:** a candidate can trigger a graded run on the visible practice data up to `runs_allowed` times (for example 10). Each run creates a `grading_jobs` row and returns the score and log when done. The final submission is scored on hidden data.
5. **Write-up and design document:** uploaded as text or PDF; routed to reviewers.

### 5.6 The grader worker

A small Python program that loops:

```
while True:
    job = claim_next_job()          # atomic: sets status=running, worker_id
    if job is None:
        sleep(5); continue
    result = GRADERS[job.kind](job) # dispatch by kind
    save_result(job, result)        # writes JSON + marks done or failed
```

`claim_next_job` uses a database row lock so two workers never take the same job. If a job stays in `running` too long, a cleanup step requeues it.

**Grader kinds**

| Kind | Track | How it scores |
| --- | --- | --- |
| `predictions` | AI Part A | Candidate uploads a predictions file; the worker compares with hidden labels and computes macro-F1. No candidate code is run. |
| `retrieval` | AI Part B | Candidate uploads, for each of 20 provided questions, the article IDs they retrieved and their answer. The worker scores retrieval hits and refusals on the unanswerable questions. Answer quality goes to a reviewer. |
| `device_sim` | IoT Parts A and B | Runs the candidate's code in the sandbox against scripted scenarios using a simulated clock (section 6). |
| `robot_sim` | Robotics Parts A and B | Runs the candidate's controller in a lightweight simulator with several seeds, takes the median (section 7). |
| `static_checks` | All | Scans for hardcoded credentials, banned imports, attempts to read hidden data; flags for reviewers. |

Every result is a JSON record with sub-scores, so the review screen can show exactly how points were earned.

### 5.7 Review console

- A reviewer sees a queue of assigned items. Each item shows the candidate's work, the rubric with anchor descriptions for each score, and the automatic results if relevant.
- Scores are saved per criterion with an optional comment.
- A function checks agreement: if two reviewers differ by more than 1 point on an item average, it creates a third assignment automatically.
- For Stage 4, the reviewer fills the five-criterion rubric right after the call, in the same console.
- Reviewers cannot see the other reviewer's score until they submit their own.

### 5.8 Scoring and credentials

- One function `compute_overall(application_id)` reads `stage_results`, applies 0.15, 0.25, 0.35 and 0.25 weights, checks each stage minimum, and assigns the tier (Certified 70, Certified Pro 80 with Stage 3 at 75, Elite 90 with Stage 4 average at 3.5).
- An admin reviews and clicks approve. Approval creates the `credentials` row with a random `verify_code` and expiry in 24 months.
- A public page `/verify/{code}` shows the limited details from section 5.2.
- The employer scorecard (PDF or web page) shows tier, overall, per-domain exam percentages, project summary, reviewer comments (admin-approved) and communication rating.

### 5.9 Admin console

- Question bank: add, edit, deactivate, import from CSV, see difficulty and discrimination stats per question.
- Scenario manager: upload kits and hidden data, set parameters and seeds.
- Cohorts and candidates: approve IDs, view funnel numbers (applied, Stage 1, 2, 3, 4, certified), export CSV.
- Reviewer management: assign, set capacity, mark conflicts.
- Settings: pass marks, weights, retake wait, run limits. These live in a table so you can change them from the pilot data without redeploying.

## 6. IoT track: how to grade without real hardware or a browser simulator

For v1 provide a small **virtual device library** in Python with the same shape as typical microcontroller code:

```
sensor.read_temp(), sensor.read_door()
net.is_connected(), mqtt.publish(topic, payload, qos)
mqtt.on_message(callback)
clock.now(), clock.sleep(seconds)   # simulated time, runs instantly
buzzer.on(), buzzer.off()
sleep.deep(seconds)
```

Candidates write `device.py` (a `setup()` and a `loop()` function) and `ingest.py` (a function that processes a list of messages and returns stored records and alerts). The worker runs each against scripted scenarios: normal operation, noisy spikes, a two-minute network outage, a malformed configuration message, duplicate and out-of-order messages. The simulated clock makes a five-hour scenario run in seconds and makes results repeatable.

**What this tests well:** logic, resilience, power-aware design, message handling. **What it does not test:** C or C++ skill, real timing, wiring. The exam, the design document and the live fault diagnosis cover those, and the optional Hardware Verified badge adds real hardware later. A browser-based electronics simulator can be added later as an upgrade if its terms and automation support fit.

## 7. Robotics track: lightweight simulation for v1

A full ROS 2 and Gazebo environment in the cloud is the one part that will not run for free. For v1, build a **small 2D simulator in pure Python**: a differential-drive robot, rays for simulated LiDAR with noise, wheel odometry with drift, walls and obstacles (one moving), and a marker to detect. Candidates write a `controller.py` with a `step(sensors, dt)` function that returns a forward speed and a turning rate. The worker runs three seeds per scenario and scores the median on waypoints reached, collisions, speed-limit violations, safe stop when sensor data disappears, and smoothness.

**Be clear about the trade-off:** this tests control, perception logic and safety thinking, but not ROS 2 itself. ROS 2 knowledge is tested in the exam (frames, TF, QoS, nodes) and in the live defence and design document. When you can afford a server, add a second path where the candidate runs a Docker image of the full Gazebo and ROS 2 setup on their own machine and uploads their result log. Because that path is easier to fake, only trust it together with the live defence.

Build Robotics last. It needs the most design effort for the simulator.

## 8. Security, privacy and data limits

- **Untrusted code:** run it only inside Judge0 with no network, tight CPU, memory, time and process limits, and a read-only filesystem. Never run candidate code directly on the machine that holds your database credentials. Give the worker the smallest set of database permissions it needs.
- **Hidden data:** stored in private storage readable only by the worker's service account.
- **IDs and videos:** private storage, short-lived signed links, admin and assigned reviewer only. Delete ID images once verified and keep only a verified flag unless the law or your process requires more; delete videos 60 days after the decision.
- **Storage budget:** assuming roughly 15 MB per video, 1 GB holds about 65 videos. Plan deletion rules from day one, or ask for a link to an unlisted video instead and store only the link.
- **Personal data:** you collect IDs, videos and employment-related information from people in different countries, and you share profiles with foreign employers. Take a lawyer's view on Nigeria's data protection requirements and on the rules in the countries you place into, and write a short privacy notice and consent text before the first candidate signs up.
- **Backups:** run a weekly scheduled export of the database and storage list to a place you control.
- **Abuse:** rate-limit sign-ups and submissions, and require a verified email.

## 9. What not to build in v1

This list saves months.

- Your own video conferencing or recording
- An in-browser code editor or notebook environment
- Payments or invoicing
- An employer marketplace with search and messaging
- Automatic AI scoring of written or video answers (use reviewers first; add AI-assisted pre-scoring only after you have enough human scores to compare against)
- Mobile apps (a responsive web app is enough)
- Fancy dashboards (a few exportable tables are enough)

## 10. Build order

Assumes one developer working part time. Treat the durations as rough planning figures, not promises.

| Milestone | What gets built | Rough time | Done when |
| --- | --- | --- | --- |
| M1. Foundation | Project setup, login, roles, profiles, onboarding, ID upload, admin approval, access rules, audit log | 2 to 3 weeks | A test candidate registers and is approved; a candidate cannot read another's data |
| M2. Exam engine | Question bank, blueprint, draw, timer, answer saving, scoring, admin question import | 2 to 3 weeks | A full 40-question exam runs and scores correctly, including after a refresh |
| M3. Responses and review | Stage 1 text and video, review console, rubrics, double-scoring and third-review rule | 2 to 3 weeks | A response gets two blind scores and a final Stage 1 result |
| M4. AI track project | Scenario kit delivery, uploads, grader worker, `predictions` and `retrieval` graders, practice-run limits | 2 to 3 weeks | A candidate submits and gets an automatic score on hidden data |
| M5. Results and credentials | Overall scoring, tiers, admin approval, public verification page, scorecard, Stage 4 booking and rubric | 2 weeks | A candidate goes from registration to a verifiable credential |
| M6. Pilot | Run 20 to 30 people through the AI track; fix what breaks; tune thresholds from data | 3 to 4 weeks | Item statistics and reviewer agreement are within the targets in the blueprint |
| M7. IoT track | Judge0 setup, virtual device library, `device_sim` grader, scenario kits, IoT question bank | 4 to 5 weeks | A strong test submission scores high and a weak one scores low, repeatably |
| M8. Robotics track | 2D simulator, `robot_sim` grader, scenarios, question bank | 5 to 6 weeks | Score variation across seeds is small enough for fair pass or fail decisions |
| M9. Hardening | Weekly backups, monitoring, email limits, privacy notice, rate limits, security review | 2 weeks | You can lose the grader machine and recover within a day |

M1 to M5 is the minimum that makes the platform worth showing. Do not start M7 until the AI pilot has produced real data.

## 11. Suggested project layout

```
/web                    Next.js app
  /app
    /(candidate)        dashboard, stages, results
    /(reviewer)         queue, scoring screen
    /(admin)            questions, scenarios, cohorts, settings
    /verify/[code]      public credential check
  /lib                  Supabase client, helpers
/supabase
  /migrations           tables, functions, access rules (SQL, in version control)
  /functions            edge functions
/grader
  worker.py             job loop
  /graders              predictions.py, retrieval.py, device_sim.py, robot_sim.py
  /sdk                  virtual device library, 2D simulator
  docker-compose.yml    worker + Judge0
/docs                   blueprints, privacy notice, runbook
```

Keep every database change as a numbered migration file, so you can rebuild the whole system from scratch. That single habit makes recovery, testing and moving to a paid plan far easier.

## 12. Key risks and how to handle them

| Risk | Mitigation |
| --- | --- |
| Free-tier pause or limit hit mid-cohort | Weekly keep-alive, watch usage, budget a small paid plan before the first real cohort |
| Grader machine goes offline | Jobs wait in the queue and run when it returns; tell candidates grading can take up to a set time; move to a small server before scale |
| Unsafe candidate code | Judge0 isolation, no network, least privilege, never run code on the database host |
| Exam questions leak | Keys in a separate locked table, large bank, random draws, retire questions each quarter |
| Cheating with AI help | Blueprint relies on the live defence and randomised hidden data; the platform logs everything needed to support a decision |
| Scope creep | Section 9 list; add nothing until the pilot ends |
| Privacy and legal exposure | Minimal retention, consent text, legal review before launch |
| Solo-builder burnout | AI track first; ship M1 to M5, pilot, then decide whether IoT and Robotics are worth the extra weeks |

## 13. Decisions to make before you start coding

1. **Who is the first user?** A single partner institution for the pilot keeps support simple.
2. **Where will the grader run?** Your own machine for the pilot, or a small rented server from the start.
3. **Do you want to avoid storing videos?** Asking for an unlisted video link saves storage but gives you less control.
4. **Reviewers:** who the first two or three are, and how they are paid.
5. **Email sender:** a domain name so that emails do not land in spam. A domain is a small cost, but worth it for trust.
6. **Platform name and branding:** needed for the credential and verification page.

Once you have answered these, the first concrete step is the M1 database migration: tables, access rules, and the `advance_status` function. I can write that SQL for you next, along with the exam engine functions.
