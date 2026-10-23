# AI Track Assessment Blueprint

Version 1.0 (pilot draft) · Talent vetting platform · Track 1 of 3 (AI, IoT, Robotics)

## 1. Purpose and target profile

This blueprint defines how candidates in the AI track are tested, scored and certified. The goal is a credential that overseas employers trust enough to hire from without re-testing.

**Target role (what "shippable" means):** a junior to mid-level AI/ML or AI application engineer who can work remotely with minimal supervision. A certified candidate can:

- Clean and analyse real, messy data in Python
- Train, evaluate and debug a standard ML model without making basic methodological errors
- Build a small LLM-powered application (retrieval, prompting, evaluation)
- Write readable, reproducible code and explain their decisions in clear English
- Be honest about what they do not know

**Out of scope for v1:** research-level ML, deep reinforcement learning, large-scale distributed training, and computer vision specialisation (add as optional modules later).

## 2. Pipeline overview

| Stage | Name | Duration | Weight | Minimum to advance |
| --- | --- | --- | --- | --- |
| 0 | Application and identity check | 15 min | Gate only | Complete and verified |
| 1 | Foundation screen | 45 min | 15% | 60% |
| 2 | Technical exam | 60 min | 25% | 60% |
| 3 | Practical project | 5 hours (timed) | 35% | 60% |
| 4 | Live technical defence | 40 min | 25% | Average 2.5 of 4 |

Candidates must pass each stage to unlock the next. Stages are not concurrent. This keeps expensive reviewer time for people who have already shown they are strong.

## 3. Stage 0: Application and identity

Collect: full name, government ID photo, institution or bootcamp attached (used for partner analytics), GitHub or portfolio link, years of experience, self-declared strengths, time zone, and weekly availability. Add a consent line for data processing and for sharing profiles with employers.

Automatic checks: ID matches the name, no duplicate account (email, phone, ID), GitHub link resolves.

## 4. Stage 1: Foundation screen (15% of total)

Purpose: filter out candidates who cannot communicate clearly or reason logically, before they consume technical review time.

| Part | Content | Time | Weight within stage | Scoring |
| --- | --- | --- | --- | --- |
| A. Written explanation | Explain a technical idea to a non-technical manager in about 150 words (rotate prompts, for example: why a model that is 95% accurate may still be useless) | 15 min | 40% | Rubric, 1 to 4 on clarity, structure, accuracy, grammar |
| B. Recorded answer | 2-minute video answering one work scenario (for example: a client asks you to deploy a model that you believe is not ready) | 10 min | 30% | Rubric, 1 to 4 on clarity, reasoning, professionalism |
| C. Logic and numeracy | 15 multiple-choice questions: patterns, basic probability, reading charts | 20 min | 30% | Automatic |

Pass mark: 60% overall. Parts A and B are scored by two trained reviewers; if scores differ by more than 1 point, a third reviewer decides.

Note: English fluency is not the aim. The test is whether the candidate can communicate technical work clearly enough for a remote team.

## 5. Stage 2: Technical exam (25% of total)

**Format:** 40 questions, 60 minutes, browser-based, one question at a time, no going back. Mostly multiple choice, plus 6 short code-reading or output-prediction questions. Questions are drawn at random from a bank at least 4 times larger than each exam (see section 11).

### 5.1 Content distribution

| Domain | Questions | What it covers |
| --- | --- | --- |
| Python and data handling | 8 | Pandas and NumPy operations, missing values, joins, vectorisation, reading tracebacks |
| Statistics and ML fundamentals | 10 | Bias and variance, overfitting, regularisation, train/validation/test splits, common algorithms and when to use them, feature scaling and encoding |
| Evaluation and debugging | 8 | Metric choice (precision, recall, F1, AUC), class imbalance, data leakage, cross-validation, diagnosing poor performance |
| Deep learning and NLP basics | 4 | Neural network basics, embeddings, tokenisation, transformers at a conceptual level |
| LLM applications | 6 | Prompting, retrieval-augmented generation, chunking, hallucination and groundedness, evaluation, basic safety and privacy |
| Engineering practice | 4 | Git, environments, reproducibility, basic model serving and monitoring concepts |

### 5.2 Difficulty mix

40% easy (should be answered correctly by nearly all qualified candidates), 40% medium, 20% hard. Tag every item with its difficulty at creation and update it from pilot data.

### 5.3 Sample items (illustrative)

1. **Leakage.** A candidate scales the whole dataset, then splits into train and test sets, and reports 94% test accuracy. What is the main problem? *Answer: the scaler saw test data statistics (data leakage); fit it on training data only.*
2. **Metrics.** A fraud model reaches 99.5% accuracy on data where 0.5% of cases are fraud. What should you check first? *Answer: a confusion matrix, recall and precision on the fraud class; the model may be predicting all "not fraud".*
3. **Code reading.** Given a short snippet that drops rows with `dropna()` before computing a group mean, ask what changes in the result and why a sample could become biased.
4. **RAG.** A retrieval-based assistant returns confident answers that are not in the source documents. Which change most directly reduces this? *Answer options test understanding of grounding, retrieval quality and instructing the model to refuse when context is missing.*

### 5.4 Scoring

One point per correct answer, no negative marking. Report both overall percentage and per-domain percentages. Per-domain scores are shown on the employer scorecard, so a candidate strong in LLM applications but weak in statistics is visible as such.

## 6. Stage 3: Practical project (35% of total)

This is the most important stage. It is hard to fake and closest to real work.

### 6.1 Setup

- Cloud workspace with Python environment, pre-installed libraries and a starter repository. Candidates need only a browser.
- 5-hour timer starts when they open the workspace. Work saves automatically. Allow one session pause of up to 30 minutes for power or connectivity loss, logged by the system.
- Task variants: maintain at least 3 equivalent scenarios (same structure, different data and domain) and assign randomly.
- AI coding assistants: allowed, but candidates must disclose use in a short log. The live defence in Stage 4 tests whether they understand what they submitted. (See open decisions, section 12.)

### 6.2 Scenario template (version A: customer-support tickets)

A fictional company has 8,000 support tickets with text, metadata, and a priority label (low, medium, high). The data contains duplicates, missing values, inconsistent categories and about 5% mislabelled rows. The company also has 30 help-centre articles.

**Part A (about 2.5 hours): Prediction model** Build a model that predicts ticket priority. Deliver a reproducible notebook that cleans the data, justifies the validation approach, compares at least two models, and reports results with an appropriate metric.

**Part B (about 2 hours): Retrieval-based assistant** Build a small assistant that answers customer questions using only the help-centre articles. It must cite the article used and decline questions the articles cannot answer.

**Final 30 minutes: Write-up** One page: what was done, what was not done and why, known weaknesses, what you would do with another week.

### 6.3 Scoring (100 points)

| Component | Points | How it is graded |
| --- | --- | --- |
| A1. Model performance | 15 | Automatic: macro-F1 on hidden test set, scored against thresholds set during pilot |
| A2. Method correctness | 15 | Automatic checks plus reviewer: no leakage, sensible split, deduplication handled, imbalance addressed |
| A3. Data cleaning and analysis | 10 | Reviewer rubric |
| B1. Retrieval quality | 15 | Automatic: correct article retrieved in top 3 on 20 hidden questions |
| B2. Answer quality and groundedness | 15 | Automatic judge model, spot-checked by a human on 20% of submissions |
| B3. Correct refusal | 10 | Automatic: 5 of the 20 hidden questions are unanswerable; reward declining them |
| C. Code quality and reproducibility | 10 | Automatic: notebook runs top to bottom in a fresh environment; reviewer reads structure and naming |
| D. Write-up | 10 | Reviewer rubric: honesty about limits scores higher than overclaiming |

**Pass mark:** 60 points, with at least 40% in each of Part A and Part B (so someone cannot pass on one half alone).

### 6.4 Automatic integrity checks

- Notebook execution in a clean container
- Commit history review: flag a single large paste of finished code in the final minutes
- Similarity detection against other submissions and the public solutions you know about
- Check that no hidden test data was accessed

Flags go to a reviewer; they do not cause automatic failure.

## 7. Stage 4: Live technical defence (25% of total)

**Format:** 40-minute video call with one trained reviewer (a practising AI engineer), camera on, candidate shares their own Stage 3 submission.

| Segment | Time | What the reviewer does |
| --- | --- | --- |
| Walkthrough | 10 min | Candidate explains their approach and key decisions |
| Probing | 10 min | Reviewer asks "why" on specific choices: split strategy, metric, chunk size, prompt design |
| Live change | 15 min | Reviewer asks for a modification (for example: "the business now cares more about catching high-priority tickets; what changes?") and watches the candidate reason and edit |
| Close | 5 min | Candidate questions; reviewer notes professionalism |

### 7.1 Rubric (score each 1 to 4)

| Dimension | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Understanding of own work | Cannot explain submitted code | Explains parts only | Explains all main decisions | Explains decisions and alternatives and trade-offs |
| Fundamentals depth | Major gaps | Surface knowledge | Solid | Strong, can teach it |
| Live problem solving | Stuck | Needs heavy hints | Solves with light guidance | Solves independently and checks own work |
| Communication | Hard to follow | Understandable with effort | Clear | Clear, concise, adapts to the listener |
| Honesty and professionalism | Bluffs when unsure | Defensive | Admits limits | Admits limits and proposes how to find out |

**Pass:** average of at least 2.5, and no score of 1 in "Understanding of own work" (an automatic fail signal for borrowed or AI-generated work the candidate cannot explain).

Convert to a percentage for the overall score: (average - 1) / 3 × 100.

Two reviewers independently score a recording for 20% of interviews to measure reviewer agreement.

## 8. Overall scoring and tiers

**Overall score** = 0.15 × Stage 1 + 0.25 × Stage 2 + 0.35 × Stage 3 + 0.25 × Stage 4

| Tier | Requirement | Meaning for employers |
| --- | --- | --- |
| Certified | Overall 70 or above, all stage minimums met | Ready for a supervised junior to mid role |
| Certified Pro | Overall 80 or above, Stage 3 at 75 or above | Can work independently on well-defined projects |
| Elite | Overall 90 or above, Stage 4 average 3.5 or above | Top of the pool; priority for senior and lead roles |

Candidates who pass stages but miss 70 receive a feedback report and may retake the failed stage after 60 days (maximum two retakes per year). Different task variants are used on retakes.

**Scorecard shown to employers:** tier, overall score, per-domain exam percentages, practical project summary and reviewer comments, communication rating, languages, availability.

## 9. Integrity and anti-cheating

- Identity check at Stage 0 and again at the start of Stage 4 (ID shown on camera)
- Randomised question draws and rotating project scenarios
- Browser focus and tab-switching log during the exam (flag, do not auto-fail)
- Commit-history and similarity checks on the project
- Live defence is the main safeguard: work the candidate cannot explain or modify does not pass
- Credentials expire after 24 months, or on request by an employer who reports a mismatch
- Published code of conduct; confirmed cheating means a permanent ban and notification to the partner institution

## 10. Accessibility and fairness for your candidate base

- Make every stage resumable after power or connectivity loss, with limited logged pauses
- Keep the exam and project light enough for low bandwidth; avoid large downloads
- Offer a test of the platform before the real attempt (a 10-minute practice round)
- Use plain, unambiguous English in questions; avoid idioms and region-specific examples
- Review pass rates by institution and gender after each cohort, and investigate large gaps in case a question or scenario is biased

## 11. Item bank and calibration plan

### 11.1 Build targets before launch

| Asset | Target |
| --- | --- |
| Exam question bank | 160 questions (4× the 40 used per exam) |
| Project scenarios | 3 equivalent versions, each with hidden test data |
| Written and video prompts | 8 rotating prompts |
| Reviewer rubric guide with scored examples | 1 per rubric, including samples at each score level |

### 11.2 Pilot (before any employer sees a result)

1. Recruit 20 to 30 people across three groups: about 8 who are clearly strong (practising engineers or top graduates), about 12 mid-level, and about 8 beginners.
2. Run the full pipeline.
3. Analyse:
   - **Difficulty per question:** remove items nearly everyone gets right or wrong
   - **Discrimination:** items that strong candidates miss while weak candidates get right are flawed; fix or drop them
   - **Does the score order match reality?** The strong group should clearly outscore the beginners
   - **Reviewer agreement:** the two reviewers should usually land within 1 point
   - **Timing:** anyone running out of time across the board means the task is too long
4. Set final pass thresholds. A healthy target for the first live cohorts is a final certification rate of about 10 to 20% of applicants. If it is much higher, the bar is too low to be credible; if it is much lower, the tasks may be unfair.

### 11.3 Ongoing

- Retire and replace roughly 20% of the question bank each quarter
- Ask employers to rate placed candidates after 30 and 90 days, then compare to their scores. This is the evidence that the credential predicts performance, and it is what you will show future employers and investors.

## 12. Open decisions for you

1. **AI assistants in the practical:** allow with disclosure (recommended, since it mirrors real work and the defence tests understanding) or ban (simpler to explain, harder to enforce).
2. **LLM access for Part B:** provide a metered API proxy through the platform (best experience, costs money per candidate) or a small open-source model inside the workspace (cheaper, lower answer quality).
3. **Reviewers:** recruit 4 to 6 practising AI engineers as paid part-time reviewers. Decide pay per interview (it needs to be worth their time) and whether any are from your partner institutions (avoid reviewing your own partners' students).
4. **Fees:** whether testing is free for candidates (recommended) with employers paying on placement.
5. **Pass thresholds:** the numbers here are starting points and should be finalised from pilot data.

## 13. Suggested build order

| Week | Task |
| --- | --- |
| 1 | Finalise this blueprint; recruit reviewers and pilot candidates |
| 2 to 3 | Write 160 exam questions; build project scenario A with hidden test data and auto-grader |
| 4 | Write rubric guides with scored examples; train reviewers |
| 5 | Run pilot with 20 to 30 people |
| 6 | Analyse results, fix items, set thresholds, then open first partner cohort |

The IoT and Robotics blueprints will follow the same five-stage structure. Stages 0, 1 and 4 can be reused almost unchanged; only Stage 2 content and the Stage 3 project differ by track.
