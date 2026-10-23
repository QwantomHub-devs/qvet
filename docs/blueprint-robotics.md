# Robotics Track Assessment Blueprint

Version 1.0 (pilot draft) · Talent vetting platform · Track 3 of 3 (AI, IoT, Robotics)

## 1. Purpose and target profile

This blueprint defines how candidates in the Robotics track are tested, scored and certified. It follows the same five-stage pipeline as the AI and IoT tracks, so stages, tiers and reviewer processes are shared. What differs is the technical content and the heavier simulation environment: a robot has to be tested while it moves, senses and makes decisions, and doing that fairly over the internet is the hardest engineering problem in this track.

**Target role (what "shippable" means):** a junior to mid-level robotics software engineer who can work remotely with light supervision, most likely on a ROS 2 based mobile robot. A certified candidate can:

- Work comfortably in Linux, Git and Docker
- Write robot software in Python and/or C++ using ROS 2 (nodes, topics, services, actions, parameters, launch files)
- Reason about coordinate frames, transforms and basic kinematics without making sign or frame errors
- Implement and tune a basic controller (for example PID) for a mobile base
- Process sensor data (LiDAR, camera, odometry) and use it for obstacle avoidance, detection or localisation
- Understand how navigation and path planning work and configure or extend them
- Test in simulation and explain the gap between simulation and the real world
- Build safety into a robot: speed limits, stopping on sensor loss, watchdogs
- Diagnose why a robot misbehaves from logs, plots and the transform tree, and admit what they do not know

**Out of scope for v1:** industrial robot arm programming and manipulation planning (add as an optional module later), mechanical and electrical design, SLAM algorithm research, reinforcement learning for robot control, and any certification or safety standards work.

## 2. Pipeline overview

| Stage | Name | Duration | Weight | Minimum to advance |
| --- | --- | --- | --- | --- |
| 0 | Application and identity check | 15 min | Gate only | Complete and verified |
| 1 | Foundation screen | 45 min | 15% | 60% |
| 2 | Technical exam | 60 min | 25% | 60% |
| 3 | Practical project (simulated robot) | 5 hours (timed) | 35% | 60% |
| 4 | Live technical defence with fault diagnosis | 40 min | 25% | Average 2.5 of 4 |

Candidates must pass each stage to unlock the next. Because the Stage 3 simulation is the most expensive part of the pipeline to run, it is only unlocked for candidates who have passed Stages 1 and 2.

An optional **Hardware Verified** badge (section 9) can be added later for candidates who run their code on a real robot. It does not change the tier.

## 3. Stage 0: Application and identity

Same as the other tracks: full name, government ID photo, institution or bootcamp, GitHub or portfolio link, years of experience, time zone, weekly availability, and consent for data processing and for sharing profiles with employers.

Robotics-specific additions:

- Tools used (ROS 1, ROS 2, Gazebo, Webots, Isaac Sim, OpenCV, Nav2, MoveIt) as a checklist
- Languages used (Python, C++) and a rough comfort rating
- Link to a robot project, video or repository, if any
- Whether they have access to a physical robot or a partner lab

Automatic checks: ID matches name, no duplicate account, links resolve.

## 4. Stage 1: Foundation screen (15% of total)

Purpose: filter out candidates who cannot communicate clearly or reason logically, before technical review time is spent.

| Part | Content | Time | Weight within stage | Scoring |
| --- | --- | --- | --- | --- |
| A. Written explanation | About 150 words for a non-technical manager. Rotating prompts, for example: why a robot that works perfectly in simulation can fail on a real factory floor | 15 min | 40% | Rubric, 1 to 4 on clarity, structure, accuracy, grammar |
| B. Recorded answer | 2-minute video on a work scenario, for example: a client's warehouse robot keeps stopping for no obvious reason and they are losing money each day; what do you ask and check first? | 10 min | 30% | Rubric, 1 to 4 on clarity, reasoning, professionalism |
| C. Logic and numeracy | 15 multiple-choice questions: patterns, geometry and angles, unit conversions, basic probability, reading graphs | 20 min | 30% | Automatic |

Pass mark: 60% overall. Parts A and B are scored by two trained reviewers; if their scores differ by more than 1 point, a third decides. English fluency is not the aim; clarity for a remote team is.

## 5. Stage 2: Technical exam (25% of total)

**Format:** 40 questions, 60 minutes, browser-based, one question at a time, no going back. Mostly multiple choice, plus 8 short items (transform and kinematics calculations, code reading, reading a plot or an error message). Questions are drawn at random from a bank at least 4 times larger than each exam.

Code snippets appear in Python or C++ with the language stated; candidates are never forced to answer in the language they know less well.

### 5.1 Content distribution

| Domain | Questions | What it covers |
| --- | --- | --- |
| Programming and tooling | 6 | Linux command line, Git workflow, Docker basics, Python and C++ fundamentals relevant to robotics (references, memory, timing), reading a stack trace |
| Math for robotics | 8 | Coordinate frames and transforms, rotation matrices and quaternions, Euler angle pitfalls, forward kinematics for a simple mobile base or planar arm, units and sign conventions |
| ROS 2 architecture | 8 | Nodes, topics, services and actions and when to use each, message types, parameters, launch files, QoS compatibility, executors and callbacks, TF2, simulation time, rosbag |
| Control and dynamics | 6 | PID behaviour and tuning symptoms, saturation and integral windup, open versus closed loop, velocity versus position control, differential drive kinematics |
| Perception and state estimation | 6 | LiDAR and camera basics, noise and filtering, sensor fusion intuition, Kalman filter intuition, odometry drift, basic OpenCV operations, camera calibration concepts |
| Planning and navigation | 6 | A\* and Dijkstra, costmaps, global versus local planning, localisation versus mapping, why robots get stuck, recovery behaviours, how Nav2 is structured |

### 5.2 Difficulty mix

40% easy, 40% medium, 20% hard. Tag every item at creation and update from pilot data.

### 5.3 Sample items (illustrative)

1. **Frames.** A robot's `base_link` frame is rotated 90 degrees counter-clockwise about the vertical axis relative to the `map` frame, and its origin coincides with the map origin. A point is at (1, 0) in `base_link`. What are its coordinates in `map`? *Answer: (0, 1).*
2. **Differential drive.** Wheel radius 0.1 m, wheel separation 0.4 m. The left wheel turns at 2 rad/s and the right at 4 rad/s. Find the robot's forward speed and turning rate. *Answer: 0.3 m/s forward and 0.5 rad/s turning.*
3. **TF error.** A node prints a transform error saying a lookup would require extrapolation into the future. Name the two most likely causes. *Expected: a mismatch between simulation time and wall-clock time (a missing use of simulated time), or a transform published with wrong or stale timestamps.*
4. **QoS.** A LiDAR driver publishes with best-effort reliability. A subscriber requests reliable delivery and receives nothing, with no error. What is the problem and how do you fix it? *Expected: incompatible QoS settings; set the subscriber to match, or use a sensor-data profile.*
5. **Control.** A robot turning toward a target heading overshoots and oscillates. Which single change is most likely to help: raise the proportional gain, add or increase derivative action, or increase the integral gain? Explain. *Expected: add or increase derivative action (or lower the proportional gain).*
6. **State estimation.** In a Kalman filter, what happens to the weight given to a measurement when you increase that sensor's noise estimate, and why? *Expected: it decreases, because the filter trusts the sensor less relative to its prediction.*

### 5.4 Scoring

One point per correct answer, no negative marking. Calculation items give credit only for correct final answers within a stated tolerance. Report overall percentage and per-domain percentages; per-domain scores appear on the employer scorecard.

## 6. Stage 3: Practical project (35% of total)

This is the most important stage. It tests whether the candidate can make a robot actually do a job safely, which is very different from answering questions about robots.

### 6.1 Setup

- **Browser-based development workspace** (code editor, terminal, plots) connected to a containerised ROS 2 environment and a headless robot simulation running in the cloud. A single pinned ROS 2 long-term-support distribution and one simulator version are fixed for each exam year.
- **Low-bandwidth by design:** no live video stream by default. Candidates see plots, logs, a top-down map view and a short replay clip rendered after each run. A full 3D stream is optional for those with a good connection.
- **Hidden test harness** that spawns the robot and obstacles in randomised positions, adds sensor noise, and measures the result.
- 5-hour timer starts when the workspace opens. Work saves automatically. One logged pause of up to 30 minutes is allowed for power or connectivity loss.
- A limited number of graded runs (for example 10) against a visible practice world, so candidates cannot brute-force the hidden world.
- At least 3 equivalent scenarios rotate (suggested: warehouse delivery robot, hospital supply robot, cleaning robot), each with different maps and parameters but the same skill structure.
- AI coding assistants: allowed with a short disclosure log. The live defence checks whether the candidate understands what was submitted.

### 6.2 Scenario template (version A: warehouse delivery robot)

A fictional warehouse uses small wheeled robots to carry parts between stations. The simulated robot is a differential-drive base with a 2D LiDAR, a front camera and wheel odometry. The world contains shelves, a few static obstacles and one slowly moving obstacle.

**Part A (about 2.5 hours): Navigation and control** Write a ROS 2 package that:

- Reads LiDAR data and drives the robot through three waypoints in the warehouse
- Uses a controller of the candidate's choice for velocity and heading, with tuned parameters kept in a configuration file
- Avoids static and moving obstacles with no collisions
- Respects a speed limit, and stops safely if LiDAR data stops arriving for more than a set time

**Part B (about 1.5 hours): Perception and docking** Use the camera to detect a marker at the destination station, estimate its pose, publish it in the correct coordinate frame so that other nodes can use it, and dock the robot within a set position and angle tolerance.

**Part C (about 45 minutes): Design and safety review** A short written document containing:

- A node and topic diagram of the system
- The transform tree, with each frame explained
- A list of the five most likely failure modes and how the software handles each
- How the emergency stop and watchdog behaviour would work on a real robot
- Three things likely to behave differently on real hardware than in simulation

**Final 15 to 30 minutes: Write-up** What was done, what was left out and why, known weaknesses, what would be done next with another week.

### 6.3 Scoring (100 points)

| Component | Points | How it is graded |
| --- | --- | --- |
| A1. Mission completion | 20 | Automatic: waypoints reached within tolerance and time, median over repeated runs with different seeds |
| A2. Safety behaviour | 15 | Automatic: collisions, speed-limit violations, correct stop when sensor data is lost |
| A3. Control quality | 10 | Automatic: path error, oscillation and smoothness of velocity commands |
| B1. Marker detection accuracy | 10 | Automatic: pose error against ground truth across varied lighting and distance |
| B2. Frame and transform correctness | 10 | Automatic: published pose correct in the stated frame and available through the transform tree |
| C. Design and safety review | 15 | Reviewer rubric: correct diagrams, realistic failure modes, sound sim-to-real reasoning |
| D. Code quality and ROS practice | 10 | Automatic: builds and runs in a clean container, uses launch files and parameters, no hardcoded paths, basic tests; plus reviewer reading of structure |
| E. Write-up | 10 | Reviewer rubric: honesty about limits scores higher than overclaiming |

**Pass mark:** 60 points, with at least 40% of the points available in Part A and in Part B.

Because simulations are not perfectly repeatable, every graded scenario is run three times and the median result is used. Scoring thresholds are calibrated during the pilot (section 12) so that a normal amount of simulation variation does not decide whether someone passes.

### 6.4 Automatic integrity checks

- Randomised world layouts, start poses and noise seeds, so hardcoded paths fail
- Hidden world differs from the practice world
- Commit history review: flag one large paste of finished code in the final minutes
- Similarity detection against other submissions and known public solutions
- Static check that the code does not read ground-truth topics or modify the test harness

Flags go to a reviewer; they do not cause automatic failure.

## 7. Stage 4: Live technical defence (25% of total)

**Format:** 40-minute video call with one trained reviewer (a practising robotics engineer), camera on, candidate shares their Stage 3 submission.

| Segment | Time | What the reviewer does |
| --- | --- | --- |
| Walkthrough | 8 min | Candidate explains their design and key decisions |
| Probing | 10 min | Reviewer asks "why": controller type and gains, how the stop behaviour works, frame choices, what happens if odometry drifts |
| Live fault diagnosis | 15 min | Reviewer shows a fault: a transform tree with a missing link, a plot of a robot oscillating, a log showing the robot repeatedly stuck, or a trajectory that slowly curves off course. The candidate talks through how they would find the cause, step by step |
| Live change | 5 min | A small requirement change, for example: "the floor is now slippery and the robot must also carry a heavier load"; the candidate explains what changes in control, limits and safety |
| Close | 2 min | Candidate questions; reviewer notes professionalism |

### 7.1 Rubric (score each 1 to 4)

| Dimension | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Understanding of own work | Cannot explain submitted code | Explains parts only | Explains all main decisions | Explains decisions, alternatives and trade-offs |
| Robotics fundamentals | Major gaps in frames, kinematics or control | Surface knowledge | Solid | Strong; anticipates real-world effects such as slip, latency and noise |
| Fault diagnosis | Guesses randomly | Needs heavy hints | Systematic with light guidance | Isolates the cause independently and says how to confirm it |
| Communication | Hard to follow | Understandable with effort | Clear | Clear, concise, adapts to the listener |
| Honesty, safety and professionalism | Bluffs when unsure or ignores safety | Defensive | Admits limits and mentions basic safety | Admits limits, proposes how to find out, and raises safety unprompted |

**Pass:** average of at least 2.5, and no score of 1 in "Understanding of own work".

Convert to a percentage: (average - 1) / 3 × 100. Two reviewers independently score a recording of 20% of interviews to measure agreement.

## 8. Overall scoring and tiers

**Overall score** = 0.15 × Stage 1 + 0.25 × Stage 2 + 0.35 × Stage 3 + 0.25 × Stage 4

| Tier | Requirement | Meaning for employers |
| --- | --- | --- |
| Certified | Overall 70 or above, all stage minimums met | Ready for a supervised junior to mid role |
| Certified Pro | Overall 80 or above, Stage 3 at 75 or above | Can work independently on well-defined projects |
| Elite | Overall 90 or above, Stage 4 average 3.5 or above | Top of the pool; priority for senior and lead roles |

Candidates who pass stages but miss 70 receive a feedback report and may retake the failed stage after 60 days (maximum two retakes per year), using different task variants.

**Scorecard shown to employers:** tier, overall score, per-domain exam percentages, project summary and reviewer comments, communication rating, tools and languages used, Hardware Verified badge if earned, availability.

## 9. Optional Hardware Verified badge (Phase 2)

Simulation proves the logic. It does not prove the candidate has dealt with real-world mess: wheel slip, sensor noise, loose cables, battery sag and timing delays.

**How it works:**

1. A candidate who is Certified or above can request the badge.
2. They use a standard low-cost mobile robot kit (small differential-drive base with distance sensors and a camera), either purchased, borrowed from a partner institution, or used at a partner lab acting as a proctored testing site.
3. They run a simplified version of their project on the real robot and submit a continuous, unedited video showing the robot, a handwritten code word given at the start of the session, the terminal output and the robot completing a short course.
4. A reviewer checks the video against a checklist. Where possible, a short live fault-finding exercise on the physical robot is added (for example, one wheel's encoder cable is swapped and the candidate must find out why the robot veers off).

**Why partner labs matter:** robotics clubs, universities and technical colleges often already own robot kits. Hosting a certified test site gives them a reason to join and gives you a lower-cost, lower-cheating hardware channel.

**Safety rules:** hardware tasks use small, low-power robots only, run in a clear area with a physical stop switch and, where possible, a supervising adult at the partner lab. Candidates are never asked to operate industrial or heavy machinery.

## 10. Integrity and anti-cheating

- Identity check at Stage 0 and again at the start of Stage 4
- Randomised question draws, rotating scenarios, hidden test worlds and randomised seeds
- Limited graded runs so candidates cannot repeatedly probe the hidden world
- Browser focus and tab-switching log during the exam (flag, do not auto-fail)
- Commit-history and similarity checks on the project
- The live defence, including fault diagnosis, is the main safeguard: work that cannot be explained or adapted does not pass
- Credentials expire after 24 months, or when an employer reports a mismatch
- Published code of conduct; confirmed cheating means a permanent ban and notification to the partner institution

## 11. Accessibility and fairness for your candidate base

- Every stage is resumable after power or connectivity loss, with limited, logged pauses
- The heavy simulation runs in the cloud, so candidates need only a basic laptop and a browser; test the full workflow on a slow connection before launch
- Offer a 15-minute practice round in the workspace before the real attempt, since many candidates will not have used a cloud robotics environment before
- Use plain, unambiguous English and avoid idioms and region-specific examples
- Do not require paid hardware for the main pipeline; hardware is only for the optional badge
- Review pass rates by institution and gender after each cohort and investigate large gaps in case a question or scenario is biased

## 12. Item bank and calibration plan

### 12.1 Build targets before launch

| Asset | Target |
| --- | --- |
| Exam question bank | 160 questions (4× the 40 used per exam), including at least 40 transform, kinematics or control calculation items |
| Project scenarios | 3 equivalent versions, each with several hidden test worlds and an automatic scoring harness |
| Fault-diagnosis cases for Stage 4 | 12 cases (transform trees, oscillation plots, logs, drifting trajectories), each with a model answer |
| Written and video prompts | 8 rotating prompts |
| Reviewer rubric guide with scored examples | One per rubric, including samples at each score level |

### 12.2 Pilot (before any employer sees a result)

1. Recruit 20 to 30 people across three groups: about 8 clearly strong (working robotics engineers or top graduates), about 12 mid-level, and about 8 beginners.
2. Run the full pipeline.
3. Analyse:
   - **Difficulty per question:** remove items nearly everyone gets right or wrong
   - **Discrimination:** items that strong candidates miss while weak candidates get right are flawed; fix or drop them
   - **Does the score order match reality?** The strong group should clearly outscore the beginners
   - **Simulation variance:** run the same strong submission 10 times; if its score swings widely, the harness or thresholds need work before any candidate is judged
   - **Compute cost and latency:** record cost per candidate and how slow the workspace feels on poor connections
   - **Reviewer agreement:** two reviewers should usually land within 1 point
   - **Timing:** if many candidates run out of time, the project is too long
4. Set final pass thresholds. A healthy target for the first live cohorts is a final certification rate of roughly 10 to 20% of applicants.

### 12.3 Ongoing

- Retire and replace roughly 20% of the question bank each quarter, and rotate in new hidden worlds
- Ask employers to rate placed candidates at 30 and 90 days and compare to their scores. That evidence is what makes the credential credible.

## 13. Open decisions for you

1. **Simulator choice:** a mainstream ROS 2 simulator such as Gazebo matches what employers ask for, but is heavier to run than lightweight options. Test candidates for each, and measure cost per candidate and how reliably it runs headless.
2. **Compute budget:** a cloud robot simulation costs more per candidate than the AI or IoT tracks. Decide the maximum cost per candidate and whether Stage 3 is gated more tightly (for example, a higher Stage 2 pass mark) to control it.
3. **Languages:** allow both Python and C++ (recommended), or restrict to one for easier grading and reviewer coverage.
4. **Hardware Verified badge timing and kit sourcing:** launch with the first cohort or after the main pipeline is proven, and decide who buys and stocks robot kits.
5. **Manipulation module:** whether to add a robot arm module (conceptual kinematics and motion planning) in a later version.
6. **Reviewers:** recruit 4 to 6 practising robotics engineers as paid part-time reviewers, set pay per interview, and avoid having reviewers score their own institution's students. Robotics reviewers will be harder to find than AI reviewers, so start recruiting early.
7. **Pass thresholds:** the numbers here are starting points and should be finalised from pilot data.

## 14. Suggested build order

| Week | Task |
| --- | --- |
| 1 to 2 | Finalise this blueprint; run a simulator feasibility and cost test (headless, repeatable, scriptable); recruit reviewers |
| 3 to 4 | Write 160 exam questions; build project scenario A with its hidden worlds and scoring harness |
| 5 | Write fault-diagnosis cases and rubric guides; train reviewers |
| 6 | Run pilot with 20 to 30 people, including repeated-run variance tests |
| 7 | Analyse results, fix items and harness, set thresholds, open first partner cohort |

Stages 0, 1 and 4 (apart from the fault-diagnosis segment) are reused from the AI and IoT tracks. The same simulator feasibility test can serve both the IoT and Robotics tracks, so run it once and share the result.
