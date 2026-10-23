# IoT Track Assessment Blueprint

Version 1.0 (pilot draft) · Talent vetting platform · Track 2 of 3 (AI, IoT, Robotics)

## 1. Purpose and target profile

This blueprint defines how candidates in the IoT track are tested, scored and certified. It follows the same five-stage pipeline as the AI track, so stages, tiers and reviewer processes are shared. What differs is the technical content, and one extra challenge: IoT is hardware-adjacent, so the platform must verify real skill without assuming every candidate has equipment, power or reliable internet.

**Target role (what "shippable" means):** a junior to mid-level IoT or embedded-systems engineer who can work remotely with light supervision. A certified candidate can:

- Read a simple circuit and reason about voltage, current, pull-ups, ADC readings and power budgets
- Write reliable firmware (C/C++ or MicroPython) for a microcontroller such as an ESP32-class board
- Connect devices over common buses and wireless links (I2C, SPI, UART, Wi-Fi, BLE, LoRa) and choose between them sensibly
- Move device data to the cloud using MQTT or HTTP and handle unreliable networks
- Apply basic security: encrypted connections, no hardcoded secrets, safe over-the-air updates
- Diagnose why a deployed device misbehaves, using logs and first principles
- Explain trade-offs in clear English, and admit what they do not know

**Out of scope for v1:** PCB design, RTOS internals at kernel level, certification and compliance work (CE, FCC), industrial protocols (Modbus, CAN, OPC UA) beyond conceptual questions, and any work with mains voltage.

## 2. Pipeline overview

| Stage | Name | Duration | Weight | Minimum to advance |
| --- | --- | --- | --- | --- |
| 0 | Application and identity check | 15 min | Gate only | Complete and verified |
| 1 | Foundation screen | 45 min | 15% | 60% |
| 2 | Technical exam | 60 min | 25% | 60% |
| 3 | Practical project (simulated device plus cloud) | 5 hours (timed) | 35% | 60% |
| 4 | Live technical defence with fault diagnosis | 40 min | 25% | Average 2.5 of 4 |

Candidates must pass each stage to unlock the next. Reviewer time is only spent on candidates who have already shown strength.

An optional **Hardware Verified** badge (section 9) can be added later for candidates who reproduce their project on real hardware. It does not change the tier.

## 3. Stage 0: Application and identity

Same as the AI track: full name, government ID photo, institution or bootcamp, GitHub or portfolio link, years of experience, time zone, weekly availability, consent for data processing and for sharing profiles with employers.

IoT-specific additions:

- Which boards, sensors and protocols the candidate has used (checklist)
- Whether they have access to physical hardware or a partner lab (used only for planning the optional hardware badge)
- Photo or link of any past hardware project, if any

Automatic checks: ID matches name, no duplicate account, links resolve.

## 4. Stage 1: Foundation screen (15% of total)

Purpose: filter out candidates who cannot communicate clearly or reason logically, before technical review time is spent.

| Part | Content | Time | Weight within stage | Scoring |
| --- | --- | --- | --- | --- |
| A. Written explanation | About 150 words for a non-technical manager. Rotating prompts, for example: why a sensor that reads correctly on your desk can give wrong values in the field | 15 min | 40% | Rubric, 1 to 4 on clarity, structure, accuracy, grammar |
| B. Recorded answer | 2-minute video on a work scenario, for example: a client says 30% of their deployed devices keep going offline; what do you ask and check first? | 10 min | 30% | Rubric, 1 to 4 on clarity, reasoning, professionalism |
| C. Logic and numeracy | 15 multiple-choice questions: patterns, unit conversions, basic probability, reading graphs | 20 min | 30% | Automatic |

Pass mark: 60% overall. Parts A and B are scored by two trained reviewers; if their scores differ by more than 1 point, a third decides. English fluency is not the aim; clarity for a remote team is.

## 5. Stage 2: Technical exam (25% of total)

**Format:** 40 questions, 60 minutes, browser-based, one question at a time, no going back. Mostly multiple choice, plus 8 short items (circuit calculations, code reading, reading a serial log or timing diagram). Questions are drawn at random from a bank at least 4 times larger than each exam.

The exam is language-agnostic wherever possible. Code snippets are shown in C-style pseudocode, and MicroPython candidates are not disadvantaged.

### 5.1 Content distribution

| Domain | Questions | What it covers |
| --- | --- | --- |
| Electronics and hardware fundamentals | 6 | Ohm's law, voltage dividers, pull-up and pull-down resistors, ADC resolution and reference voltage, logic levels and level shifting, current limits of GPIO pins, reading a basic schematic |
| Embedded programming | 8 | Interrupts and why to keep them short, timers, polling versus interrupts, the meaning of volatile, state machines, debouncing, integer overflow, memory constraints, non-blocking code |
| Buses and wireless | 8 | I2C, SPI, UART trade-offs and common wiring faults, Wi-Fi versus BLE versus LoRa (range, power, data rate), MQTT basics including QoS levels, retained messages and last will |
| IoT architecture and cloud | 6 | Device-to-cloud flow, broker and topic design, device shadows or digital twins, time-series storage, edge versus cloud processing, handling duplicate and out-of-order messages |
| Security and reliability | 6 | TLS and certificates, secrets management, secure provisioning, authenticated OTA updates, watchdog timers, reconnect and back-off logic |
| Power, debugging and deployment | 6 | Sleep modes, battery life estimation, brownout behaviour, reading logs to find a field failure, safe rollout of firmware to many devices |

### 5.2 Difficulty mix

40% easy, 40% medium, 20% hard. Tag every item at creation and update from pilot data.

### 5.3 Sample items (illustrative)

1. **Voltage divider.** A 5 V sensor output must be read by a 3.3 V ADC pin. Two resistors of 10 kΩ (top) and 20 kΩ (bottom) are used. What voltage reaches the pin when the sensor outputs 5 V, and is that safe? *Answer: about 3.33 V, which is at the limit; a slightly larger ratio gives more margin.*
2. **I2C fault.** A sensor works alone on the bus, but when a second sensor is added, both stop responding. Name the two most likely causes. *Expected: duplicate address, and excessive bus capacitance or missing or wrong pull-ups.*
3. **MQTT.** A device publishes a reading every 10 seconds at QoS 0 over a poor cellular link, and the dashboard shows gaps. What change fixes lost messages, and what new problem does it introduce? *Expected: QoS 1, which can deliver duplicates, so the receiver must handle them.*
4. **Interrupts.** A button interrupt handler prints to serial and waits 50 ms for debouncing. What is wrong with this design? *Expected: blocking calls inside an interrupt; set a flag and handle it in the main loop or use a timer.*
5. **Power.** A device draws 80 mA for 2 seconds every 10 minutes and 20 µA in deep sleep the rest of the time. Roughly how long will a 2000 mAh battery last, ignoring self-discharge? Show the calculation.

### 5.4 Scoring

One point per correct answer, no negative marking. Calculation items give credit only for correct final answers within a stated tolerance. Report overall percentage and per-domain percentages; per-domain scores appear on the employer scorecard.

## 6. Stage 3: Practical project (35% of total)

This is the most important stage. It tests whether the candidate can build a complete, resilient device-to-cloud system, not just answer questions.

### 6.1 Setup

- **Browser-based device simulator** with a virtual ESP32-class board and sensors, plus a cloud sandbox with an MQTT broker, a small database and a starter repository. Candidates need only a browser.
- **Hidden test harness** that drives the simulated device through scripted scenarios and records what it does.
- 5-hour timer starts when the workspace opens. Work saves automatically. One logged pause of up to 30 minutes is allowed for power or connectivity loss.
- At least 3 equivalent scenarios are rotated, each with different parameters and randomised test seeds so hardcoding expected outputs fails.
- AI coding assistants: allowed with a short disclosure log. The live defence checks whether the candidate understands what was submitted.

### 6.2 Scenario template (version A: cold-chain monitor)

A fictional pharmacy transports vaccines in insulated boxes. Each box has a device with a temperature and humidity sensor, a door sensor and a buzzer.

**Part A (about 2.5 hours): Firmware** The device must:

- Sample sensors at a configurable interval
- Publish readings as JSON over MQTT with a sensible topic structure and QoS choice
- Ignore single noisy spikes (for example, require 3 consecutive out-of-range readings) before raising a local alarm
- Keep working when the network drops for 2 or more minutes: buffer readings in memory and send them in order on reconnect, without losing the oldest data or running out of memory
- Accept a configuration message (new interval and threshold) and reject malformed ones safely
- Use low-power waiting between readings rather than a busy loop

**Part B (about 1.5 hours): Cloud side** Write a small service that subscribes to the readings, discards duplicates, stores the data, and raises an alert if the temperature stays above the limit for a set duration. It must handle out-of-order and late messages.

**Part C (about 45 minutes): Design review document** A short written design covering the pin map and wiring of the sensors, a power budget with a battery life estimate, how secrets and certificates are handled, and how firmware updates would be delivered safely to 1,000 devices.

**Final 15 to 30 minutes: Write-up** What was done, what was left out and why, known weaknesses, what would be done next with another week.

### 6.3 Scoring (100 points)

| Component | Points | How it is graded |
| --- | --- | --- |
| A1. Functional behaviour | 20 | Automatic: share of scripted scenarios passed (normal operation, threshold breach, config change) |
| A2. Resilience | 15 | Automatic: sensor spikes, network outage with buffering and ordered resend, malformed config, repeated reconnects |
| A3. Power management | 10 | Automatic: measured simulated sleep ratio and active time versus targets |
| B1. Ingestion correctness | 10 | Automatic: duplicates removed, late and out-of-order data handled, data stored correctly |
| B2. Alert logic | 10 | Automatic: alerts fire at the right time and not on single spikes |
| C. Design review | 15 | Reviewer rubric: correct wiring and pin choices, sound power calculation, realistic security and update plan |
| D. Code quality and security hygiene | 10 | Automatic scan (no hardcoded credentials, encrypted connection used) plus reviewer reading of structure and naming |
| E. Write-up | 10 | Reviewer rubric: honesty about limits scores higher than overclaiming |

**Pass mark:** 60 points, with at least 40% of the points available in Part A and in Part B (a candidate cannot pass on firmware alone or cloud alone).

### 6.4 Automatic integrity checks

- Randomised test seeds so output cannot be hardcoded
- Commit history review: flag one large paste of finished code in the final minutes
- Similarity detection against other submissions and known public solutions
- Static check that firmware does not read or alter the test harness

Flags go to a reviewer; they do not cause automatic failure.

## 7. Stage 4: Live technical defence (25% of total)

**Format:** 40-minute video call with one trained reviewer (a practising embedded or IoT engineer), camera on, candidate shares their Stage 3 submission.

| Segment | Time | What the reviewer does |
| --- | --- | --- |
| Walkthrough | 8 min | Candidate explains their design and key decisions |
| Probing | 10 min | Reviewer asks "why": buffer size, QoS choice, debounce method, sleep strategy, what happens if the broker restarts |
| Live fault diagnosis | 15 min | Reviewer shows a fault: a serial log, a photo of a wiring diagram, or a graph of device battery voltage dropping early. The candidate talks through how they would find the cause, step by step |
| Live change | 5 min | A small requirement change, for example: "the box must now also report GPS position"; the candidate explains what changes in hardware, firmware and cloud |
| Close | 2 min | Candidate questions; reviewer notes professionalism |

### 7.1 Rubric (score each 1 to 4)

| Dimension | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Understanding of own work | Cannot explain submitted code | Explains parts only | Explains all main decisions | Explains decisions, alternatives and trade-offs |
| Hardware and electronics reasoning | Major gaps | Surface knowledge | Solid | Strong; anticipates real-world effects such as noise, voltage drop and temperature |
| Fault diagnosis | Guesses randomly | Needs heavy hints | Systematic with light guidance | Isolates the cause independently and says how to confirm it |
| Communication | Hard to follow | Understandable with effort | Clear | Clear, concise, adapts to the listener |
| Honesty, safety and professionalism | Bluffs when unsure or ignores safety | Defensive | Admits limits and mentions basic safety | Admits limits, proposes how to find out, and raises safety and security unprompted |

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

**Scorecard shown to employers:** tier, overall score, per-domain exam percentages, project summary and reviewer comments, communication rating, boards and protocols used, Hardware Verified badge if earned, availability.

## 9. Optional Hardware Verified badge (Phase 2)

A simulator proves logic. It does not prove the candidate can wire a breadboard, solder, or fix a loose connection. The badge closes that gap without slowing the main pipeline.

**How it works:**

1. A candidate who is Certified or above can request the badge.
2. They use a standard low-cost kit (an ESP32-class board, a temperature and humidity sensor, a door switch, a buzzer, cables) either purchased, borrowed from a partner institution's lab, or used at a partner lab acting as a proctored testing site.
3. They reproduce a simplified version of their project on real hardware and submit a continuous, unedited video that shows the board, the wiring, a handwritten code word given at the start of the session, the serial output and the buzzer or LED responding to a live temperature change.
4. A reviewer checks the video against a checklist. Where possible, a short live fault-finding exercise on the physical rig is added (the reviewer secretly specifies a fault: for example, a swapped pull-up or a wrong pin).

**Why partner labs matter:** institutions with workshops can host kits and act as local testing centres. That gives them a reason to join and gives you a lower-cost, lower-cheating hardware channel.

**Safety rule:** all hardware tasks are low voltage only. Candidates are never asked to work with mains electricity.

## 10. Integrity and anti-cheating

- Identity check at Stage 0 and again at the start of Stage 4
- Randomised question draws, rotating scenarios and randomised test seeds
- Browser focus and tab-switching log during the exam (flag, do not auto-fail)
- Commit-history and similarity checks on the project
- The live defence, including fault diagnosis, is the main safeguard: work that cannot be explained or adapted does not pass
- Credentials expire after 24 months, or when an employer reports a mismatch
- Published code of conduct; confirmed cheating means a permanent ban and notification to the partner institution

## 11. Accessibility and fairness for your candidate base

- Every stage is resumable after power or connectivity loss, with limited, logged pauses
- The simulator and workspace must run on low-spec laptops and modest bandwidth; test on a slow connection before launch
- Offer a 10-minute practice round on the simulator before the real attempt, because many candidates will not have used it before
- Use plain, unambiguous English in questions and avoid idioms and region-specific examples
- Do not require paid hardware for the main pipeline; hardware is only for the optional badge
- Review pass rates by institution and gender after each cohort and investigate large gaps in case a question or scenario is biased

## 12. Item bank and calibration plan

### 12.1 Build targets before launch

| Asset | Target |
| --- | --- |
| Exam question bank | 160 questions (4× the 40 used per exam), including at least 30 calculation or log-reading items |
| Project scenarios | 3 equivalent versions (suggested: cold-chain monitor, smart irrigation, indoor air-quality station), each with a scripted test harness |
| Fault-diagnosis cases for Stage 4 | 12 cases (serial logs, wiring photos, battery graphs), each with a model answer |
| Written and video prompts | 8 rotating prompts |
| Reviewer rubric guide with scored examples | One per rubric, including samples at each score level |

### 12.2 Pilot (before any employer sees a result)

1. Recruit 20 to 30 people across three groups: about 8 clearly strong (working embedded or IoT engineers, or top graduates), about 12 mid-level, and about 8 beginners.
2. Run the full pipeline.
3. Analyse:
   - **Difficulty per question:** remove items nearly everyone gets right or wrong
   - **Discrimination:** items that strong candidates miss while weak candidates get right are flawed; fix or drop them
   - **Does the score order match reality?** The strong group should clearly outscore the beginners
   - **Simulator fairness:** check whether failures come from candidates' skill or from simulator quirks and unclear instructions; fix any harness bug before judging candidates
   - **Reviewer agreement:** two reviewers should usually land within 1 point
   - **Timing:** if many candidates run out of time, the project is too long
4. Set final pass thresholds. A healthy target for the first live cohorts is a final certification rate of roughly 10 to 20% of applicants.

### 12.3 Ongoing

- Retire and replace roughly 20% of the question bank each quarter
- Ask employers to rate placed candidates at 30 and 90 days and compare to their scores. That evidence is what makes the credential credible.

## 13. Open decisions for you

1. **Simulator approach:** use an existing browser-based simulator or build your own lightweight simulated device. Check licensing, whether it supports automated test scripts, and whether it can run your hidden harness. This is the biggest technical risk in the track, so test it first.
2. **Languages:** allow both C/C++ and MicroPython (recommended, since the exam is mostly language-agnostic) or restrict to one for easier grading.
3. **Hardware Verified badge timing:** launch it with the first cohort or after the main pipeline is proven.
4. **Kit sourcing:** who buys and stocks the kits, and whether partner labs host them.
5. **Cloud sandbox:** who hosts the MQTT broker and database, and the cost per candidate.
6. **Reviewers:** recruit 4 to 6 practising embedded or IoT engineers as paid part-time reviewers, set pay per interview, and avoid having reviewers score their own institution's students.
7. **Pass thresholds:** the numbers here are starting points and should be finalised from pilot data.

## 14. Suggested build order

| Week | Task |
| --- | --- |
| 1 | Finalise this blueprint; run a simulator feasibility test (can it run a scripted harness?); recruit reviewers |
| 2 to 3 | Write 160 exam questions; build project scenario A with its harness |
| 4 | Write fault-diagnosis cases and rubric guides; train reviewers |
| 5 | Run pilot with 20 to 30 people |
| 6 | Analyse results, fix items and harness, set thresholds, open first partner cohort |

Stages 0, 1 and 4 (apart from the fault-diagnosis segment) are reused from the AI track, which keeps the extra build effort for this track mostly in the question bank, the project scenario and the harness.
