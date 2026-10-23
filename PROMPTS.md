# Prompts for the coding agent

Use these one at a time, in order. Use **Planning mode** for every milestone. Read the plan the agent produces before approving it. After each milestone, run the checks yourself.

Folder setup before starting: create a Git repository containing `AGENTS.md` at the root, and a `/docs` folder with the four documents exported as Markdown (`platform-design.md`, `blueprint-ai.md`, `blueprint-iot.md`, `blueprint-robotics.md`).

---

## 0. Kickoff (no code yet)

> Read `AGENTS.md` and everything in `/docs`. Do not write any code yet.
>
> Produce: (1) a short summary of the system in your own words, so I can check you understood it; (2) a list of contradictions, gaps or ambiguities you found in the docs; (3) the questions you need answered before starting M1; (4) a proposed repository structure; (5) the implementation plan for M1 only.
>
> Wait for my answers and approval before continuing.

---

## M1. Foundation

> Implement milestone M1 from section 10 of `/docs/platform-design.md`: project setup, login, roles, profiles, onboarding (track choice, consent, ID upload), admin approval of IDs, the status machine with `advance_status`, access rules (RLS) on every table, and the audit log.
>
> Requirements: use the data model in section 5.1 (create only the tables M1 needs, but design so the rest can be added by later migrations); write the RLS policies from section 5.2; private storage for ID documents with signed URLs; admin reads of ID documents are logged.
>
> Show me the plan first. After I approve, build it, then deliver automated tests proving: a candidate cannot read another candidate's data; a candidate cannot write status or scores; illegal status transitions are rejected.
>
> Acceptance: a test candidate registers, uploads an ID, an admin approves, and the status becomes `approved`. The database rebuilds from migrations on a fresh local Supabase.

---

## M2. Exam engine

> Implement M2: question bank (with answer keys in a separate locked table), exam blueprints, random draw according to the blueprint distribution, server-side timer, one-question-at-a-time delivery, answer locking, scoring (including numeric answers with tolerance), integrity event logging (tab hidden, fullscreen exit), admin CSV import for questions.
>
> Follow sections 5.3 and the AI track blueprint section 5. Also create a seed script with 40 clearly marked **fake sample questions** across the blueprint domains so I can test. Do not present them as real assessment content.
>
> Tests required: draw matches distribution; refresh resumes with correct remaining time; going back is impossible; auto-submit at deadline; candidates cannot fetch correct answers by any request.
>
> Plan first. Then build. Then report what is not tested.

---

## M3. Stage 1 responses and the review console

> Implement M3: the Foundation screen (written explanation with autosave, browser video recording limited to 2 minutes at low resolution with a file-upload fallback, logic questions reusing the exam engine), the reviewer assignment logic (blind review, no same-institution assignment, second reviewer, automatic third reviewer when scores differ by more than 1), and the review console with rubric anchors.
>
> Follow sections 5.4 and 5.7 of the platform design and section 4 of the AI blueprint. Rubrics come from a table so I can edit them.
>
> Tests required: a reviewer never sees name or institution; a reviewer cannot see the other reviewer's score before submitting; third-review rule triggers correctly.

---

## M4. AI track project and the grader worker

> Implement M4: scenario kit delivery with time-limited download links, the project attempt timer with one logged pause, file submissions per part, the practice-run limit, the `grading_jobs` queue, and the Python grader worker with the `predictions` and `retrieval` graders.
>
> The worker must claim jobs atomically, only make outbound connections, and requeue stuck jobs. Hidden labels live in private storage readable only by the worker's credentials. Scoring components and points are in section 6.3 of the AI blueprint.
>
> Create a **fake sample scenario** with synthetic data to test the full flow end to end, and tests for the macro-F1 calculation using hand-checked examples.
>
> Do not build a code sandbox yet. For the AI track, candidates upload prediction files and the worker scores them.

---

## M5. Results, credentials and Stage 4

> Implement M5: `compute_overall` using the weights, stage minimums and tier thresholds from the `settings` table; admin approval of credentials; random `verify_code`; the public `/verify/[code]` page that shows only name, track, tier, date and valid or revoked; the employer scorecard page; Stage 4 booking (a stored meeting link and time) and the five-criterion rubric form for the reviewer.
>
> Tests required: worked examples of overall score and tier (including values exactly on thresholds and a candidate who is high overall but below one stage minimum); revoked credentials show as invalid; the verify page leaks nothing else.

---

## After M2, M4 and M5: security review

> Act as a security reviewer. Audit the repository for: missing or weak RLS policies; any path by which a candidate could read answer keys, hidden data or other candidates' data; any path to change status, score or deadline from the browser; secrets in the repo; the service-role key exposed to the client; insecure file upload handling; missing rate limits; and logging of sensitive data.
>
> Write attack attempts as automated tests where possible. Report findings by severity, with the file and line, and propose fixes. Do not fix anything until I approve.

---

## Before the pilot

> Prepare the system for a pilot of 30 people: a weekly data export script, a keep-alive job, upload cleanup jobs, an admin funnel view (applied, each stage, certified), CSV exports, a runbook in `/docs/runbook.md` covering how to restore from backup and what to do if the grader machine is offline, and a privacy notice template (marked as needing legal review).

---

## Later milestones (only after the AI pilot produces real data)

- **M7 IoT:** "Implement milestone M7: Judge0 sandbox setup, the virtual device library, the `device_sim` grader and scenario kits, following section 6 of the platform design and the IoT blueprint. Show me the sandbox security design first."
- **M8 Robotics:** "Implement milestone M8: the 2D Python simulator, the `robot_sim` grader running three seeds and taking the median, following section 7 of the platform design and the Robotics blueprint. Show me how you will keep results repeatable first."
