"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  GradingJob,
  ProjectAttempt,
  ProjectComponentScore,
  Scenario,
  Submission,
  SubmissionPart,
} from "@/lib/types/database";
import {
  finalizeProjectAction,
  getProjectStatusAction,
  pauseProjectAction,
  requestPracticeRunAction,
  resumeProjectAction,
  startProjectAction,
  uploadSubmissionFileAction,
} from "@/actions/project";

interface Props {
  applicationId: string;
  initialAttempt?: ProjectAttempt;
  initialScenario?: Scenario;
  initialSubmissions?: Submission[];
  initialPracticeJobs?: GradingJob[];
  initialFinalJobs?: GradingJob[];
  initialComponentScores?: ProjectComponentScore[];
  initialStarterKitUrl?: string;
  initialRemainingSeconds?: number;
}

const PART_LABELS: Record<SubmissionPart, { title: string; hint: string; accept: string; maxMb: number }> = {
  predictions: {
    title: "Part A1: Predictions (CSV)",
    hint: "Must contain 'ticket_id' and 'priority' columns for test tickets.",
    accept: ".csv,text/csv",
    maxMb: 2,
  },
  retrieval: {
    title: "Part B: Retrieval & Refusal (JSON)",
    hint: "Structured JSON containing top-3 retrieved articles and refusal flags.",
    accept: ".json,application/json",
    maxMb: 1,
  },
  notebook: {
    title: "Part C1: Jupyter Notebook (.ipynb)",
    hint: "Complete notebook with exploratory analysis and modeling execution.",
    accept: ".ipynb,application/x-ipynb+json",
    maxMb: 10,
  },
  code: {
    title: "Part C2: Modular Codebase (.zip)",
    hint: "Self-contained project directory with scripts and requirements.txt.",
    accept: ".zip,application/zip",
    maxMb: 15,
  },
  writeup: {
    title: "Part D: Technical Report (.pdf or .md)",
    hint: "Concise analysis of methodology, trade-offs, and failure modes (max 2 pages).",
    accept: ".pdf,.md,text/markdown,application/pdf",
    maxMb: 2,
  },
};

export default function ProjectWorkspaceClient({
  applicationId,
  initialAttempt,
  initialScenario,
  initialSubmissions = [],
  initialPracticeJobs = [],
  initialFinalJobs = [],
  initialComponentScores = [],
  initialStarterKitUrl,
  initialRemainingSeconds = 0,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [attempt, setAttempt] = useState<ProjectAttempt | undefined>(initialAttempt);
  const [scenario, setScenario] = useState<Scenario | undefined>(initialScenario);
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions);
  const [practiceJobs, setPracticeJobs] = useState<GradingJob[]>(initialPracticeJobs);
  const [finalJobs, setFinalJobs] = useState<GradingJob[]>(initialFinalJobs);
  const [componentScores, setComponentScores] = useState<ProjectComponentScore[]>(initialComponentScores);
  const [starterKitUrl, setStarterKitUrl] = useState<string | undefined>(initialStarterKitUrl);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialRemainingSeconds);

  const [aiDisclosure, setAiDisclosure] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadingPart, setUploadingPart] = useState<SubmissionPart | null>(null);

  // Sync remaining time countdown
  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress" || remainingSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [attempt, remainingSeconds]);

  // Periodic polling for status and job updates (every 5 seconds when in_progress or submitted)
  useEffect(() => {
    if (!attempt) return;
    const interval = setInterval(async () => {
      const res = await getProjectStatusAction(applicationId);
      if (res.ok) {
        if (res.attempt) setAttempt(res.attempt);
        if (res.submissions) setSubmissions(res.submissions);
        if (res.practiceJobs) setPracticeJobs(res.practiceJobs);
        if (res.finalJobs) setFinalJobs(res.finalJobs);
        if (res.componentScores) setComponentScores(res.componentScores);
        if (res.starterKitUrl) setStarterKitUrl(res.starterKitUrl);
        if (typeof res.remainingSeconds === "number") setRemainingSeconds(res.remainingSeconds);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [applicationId, attempt]);

  const formatTime = (secs: number) => {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleStartProject = () => {
    setErrorMessage(null);
    setStatusMessage("Starting project attempt and unlocking dataset...");
    startTransition(async () => {
      const res = await startProjectAction(applicationId);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Failed to start project.");
        setStatusMessage(null);
        return;
      }
      const statusRes = await getProjectStatusAction(applicationId);
      if (statusRes.ok && statusRes.attempt) {
        setAttempt(statusRes.attempt);
        setScenario(statusRes.scenario);
        setStarterKitUrl(statusRes.starterKitUrl);
        setRemainingSeconds(statusRes.remainingSeconds ?? 0);
      }
      setStatusMessage(null);
      router.refresh();
    });
  };

  const handlePause = () => {
    if (!attempt) return;
    setErrorMessage(null);
    startTransition(async () => {
      const res = await pauseProjectAction(attempt.id);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Failed to pause project.");
        return;
      }
      const statusRes = await getProjectStatusAction(applicationId);
      if (statusRes.ok && statusRes.attempt) {
        setAttempt(statusRes.attempt);
      }
      router.refresh();
    });
  };

  const handleResume = () => {
    if (!attempt) return;
    setErrorMessage(null);
    startTransition(async () => {
      const res = await resumeProjectAction(attempt.id);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Failed to resume project.");
        return;
      }
      const statusRes = await getProjectStatusAction(applicationId);
      if (statusRes.ok && statusRes.attempt) {
        setAttempt(statusRes.attempt);
        setRemainingSeconds(statusRes.remainingSeconds ?? 0);
      }
      router.refresh();
    });
  };

  const handleFileUpload = async (part: SubmissionPart, file: File) => {
    if (!attempt) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setUploadingPart(part);

    const formData = new FormData();
    formData.append("attemptId", attempt.id);
    formData.append("part", part);
    formData.append("file", file);

    const res = await uploadSubmissionFileAction(formData);
    setUploadingPart(null);

    if (!res.ok) {
      setErrorMessage(res.error ?? "Upload failed.");
      return;
    }

    setStatusMessage(`Uploaded ${part} successfully.`);
    const statusRes = await getProjectStatusAction(applicationId);
    if (statusRes.ok && statusRes.submissions) {
      setSubmissions(statusRes.submissions);
    }
  };

  const handlePracticeRun = (part: "predictions" | "retrieval") => {
    if (!attempt) return;
    setErrorMessage(null);
    setStatusMessage(`Queueing practice grading run for ${part}...`);

    startTransition(async () => {
      const res = await requestPracticeRunAction(attempt.id, part);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Practice run failed.");
        setStatusMessage(null);
        return;
      }
      setStatusMessage(`Practice run queued. Job #${res.job?.id?.slice(0, 8)}. Worker will grade shortly.`);
      const statusRes = await getProjectStatusAction(applicationId);
      if (statusRes.ok) {
        if (statusRes.practiceJobs) setPracticeJobs(statusRes.practiceJobs);
        if (statusRes.attempt) setAttempt(statusRes.attempt);
      }
    });
  };

  const handleFinalize = () => {
    if (!attempt) return;
    if (
      !confirm(
        "Are you sure you want to finalize and submit your project? Once submitted, no further changes can be made."
      )
    ) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage("Submitting your practical project for automated and blind reviewer scoring...");

    startTransition(async () => {
      const res = await finalizeProjectAction(attempt.id, aiDisclosure);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Finalization failed.");
        setStatusMessage(null);
        return;
      }
      setStatusMessage("Project submitted successfully!");
      const statusRes = await getProjectStatusAction(applicationId);
      if (statusRes.ok && statusRes.attempt) {
        setAttempt(statusRes.attempt);
        if (statusRes.finalJobs) setFinalJobs(statusRes.finalJobs);
      }
      router.refresh();
    });
  };

  // If no attempt has been started yet
  if (!attempt) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full uppercase tracking-wider mb-2">
            Stage 3: Practical Project
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">
            {scenario?.title ?? "AI Engineering Practical Project"}
          </h1>
          <p className="text-slate-600 mb-6 leading-relaxed">
            {scenario?.description ??
              "Complete an end-to-end ML classification and RAG pipeline challenge under realistic constraints."}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase">Time Allotted</div>
              <div className="text-lg font-bold text-slate-800">5 Hours</div>
              <div className="text-xs text-slate-500 mt-1">One optional 30m pause</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase">Practice Runs</div>
              <div className="text-lg font-bold text-slate-800">10 Practice Runs</div>
              <div className="text-xs text-slate-500 mt-1">Instant metrics feedback</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase">Pass Threshold</div>
              <div className="text-lg font-bold text-slate-800">60 / 100 Points</div>
              <div className="text-xs text-slate-500 mt-1">Min 40% on Part A & B</div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 mb-6 text-sm text-amber-900 leading-relaxed">
            <strong>Important Notice:</strong> Clicking <em>Start Project Attempt</em> starts your 5-hour
            server countdown. Ensure you have a stable workspace and environment ready before starting.
          </div>

          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg mb-6 text-sm">
              {errorMessage}
            </div>
          )}

          <button
            onClick={handleStartProject}
            disabled={isPending}
            className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {isPending ? "Starting Attempt..." : "Start Project Attempt (5 Hours)"}
          </button>
        </div>
      </div>
    );
  }

  const isPaused = attempt.status === "paused";
  const isSubmitted = attempt.status === "submitted";
  const isExpired = attempt.status === "expired";
  const canUpload = attempt.status === "in_progress";

  const getLatestSubmission = (part: SubmissionPart) =>
    submissions.find((s) => s.part === part);

  const getLatestPracticeJob = (part: SubmissionPart) =>
    practiceJobs.find((j) => j.part === part);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Workspace Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full uppercase">
                Stage 3 Project
              </span>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full uppercase ${
                  isSubmitted
                    ? "bg-emerald-100 text-emerald-800"
                    : isPaused
                    ? "bg-amber-100 text-amber-800"
                    : isExpired
                    ? "bg-red-100 text-red-800"
                    : "bg-blue-100 text-blue-800"
                }`}
              >
                {attempt.status.replace("_", " ")}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900">{scenario?.title}</h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Timer Display */}
            {!isSubmitted && (
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-500 uppercase">Time Remaining</div>
                <div
                  className={`text-2xl font-mono font-bold ${
                    isPaused
                      ? "text-amber-600"
                      : remainingSeconds < 1800
                      ? "text-red-600 animate-pulse"
                      : "text-slate-900"
                  }`}
                >
                  {formatTime(remainingSeconds)}
                </div>
                {isPaused && (
                  <span className="text-xs text-amber-600 font-medium">Session Paused</span>
                )}
              </div>
            )}

            {/* Pause / Resume Controls */}
            {canUpload && attempt.pause_count === 0 && (
              <button
                onClick={handlePause}
                disabled={isPending}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition"
              >
                Take Pause (up to 30m)
              </button>
            )}

            {isPaused && (
              <button
                onClick={handleResume}
                disabled={isPending}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
              >
                Resume Project
              </button>
            )}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
          {errorMessage}
        </div>
      )}

      {/* Starter Kit Download Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-6 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-blue-900 mb-1">
            Starter Kit & Dataset Files
          </h2>
          <p className="text-sm text-blue-700">
            Contains <code className="bg-blue-100 px-1 rounded">train.csv</code>, practice tickets,
            knowledge base articles, starter notebook, and evaluation queries.
          </p>
        </div>
        {starterKitUrl ? (
          <a
            href={starterKitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-sm transition whitespace-nowrap"
          >
            Download Starter Kit (.zip)
          </a>
        ) : (
          <span className="text-xs text-slate-500 italic">Starter kit link expired. Refreshing...</span>
        )}
      </div>

      {/* Practice Runs Status Counter */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase">Practice Runs Remaining</span>
          <div className="text-lg font-bold text-slate-800">
            {attempt.runs_allowed - attempt.runs_used} of {attempt.runs_allowed} runs remaining
          </div>
        </div>
        <div className="text-xs text-slate-500 max-w-sm text-right">
          Practice runs evaluate your predictions against practice data and return instant Macro-F1 and top-3 accuracy diagnostics.
        </div>
      </div>

      {/* Deliverables Cards */}
      <div className="space-y-4">
        {(Object.keys(PART_LABELS) as SubmissionPart[]).map((part) => {
          const cfg = PART_LABELS[part];
          const sub = getLatestSubmission(part);
          const pJob = getLatestPracticeJob(part);
          const isGradable = part === "predictions" || part === "retrieval";

          return (
            <div
              key={part}
              className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col gap-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{cfg.title}</h3>
                  <p className="text-xs text-slate-500">{cfg.hint}</p>
                </div>
                <div className="text-xs text-slate-400">Max size: {cfg.maxMb} MB</div>
              </div>

              {/* Current submission status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <div>
                  {sub ? (
                    <div>
                      <span className="font-medium text-slate-800">{sub.file_name}</span>{" "}
                      <span className="text-xs text-slate-500">
                        ({(sub.file_size_bytes / 1024).toFixed(1)} KB, v{sub.version})
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-400 italic">No file submitted yet</span>
                  )}
                </div>

                {canUpload && (
                  <label className="inline-flex items-center px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium border border-slate-300 rounded cursor-pointer transition">
                    <span>{sub ? "Replace File" : "Choose File"}</span>
                    <input
                      type="file"
                      accept={cfg.accept}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(part, file);
                      }}
                      disabled={uploadingPart === part || isPending}
                    />
                  </label>
                )}
              </div>

              {/* Practice Run Controls & Diagnostics for Part A and Part B */}
              {isGradable && sub && (
                <div className="mt-1 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    {pJob ? (
                      <div className="text-xs">
                        <span className="font-semibold text-slate-700">Latest Practice Result: </span>
                        {pJob.status === "queued" && (
                          <span className="text-amber-600 font-medium">Queued in grader worker...</span>
                        )}
                        {pJob.status === "running" && (
                          <span className="text-blue-600 font-medium">Running evaluation...</span>
                        )}
                        {pJob.status === "done" && (
                          <span className="text-emerald-700 font-medium">{pJob.candidate_feedback}</span>
                        )}
                        {pJob.status === "failed" && (
                          <span className="text-red-600 font-medium">{pJob.candidate_feedback}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Ready for practice evaluation on visible practice data.
                      </span>
                    )}
                  </div>

                  {canUpload && attempt.runs_used < attempt.runs_allowed && (
                    <button
                      onClick={() => handlePracticeRun(part as "predictions" | "retrieval")}
                      disabled={isPending || pJob?.status === "queued" || pJob?.status === "running"}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded transition disabled:opacity-50 whitespace-nowrap"
                    >
                      Run Practice Grader
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Tool Usage Disclosure & Final Submission */}
      {!isSubmitted && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Final Project Submission
          </h2>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              AI Tool Usage Disclosure (Optional)
            </label>
            <textarea
              rows={2}
              value={aiDisclosure}
              onChange={(e) => setAiDisclosure(e.target.value)}
              placeholder="E.g., Used GitHub Copilot for boilerplate typing, Claude for regex debugging."
              className="w-full text-sm p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              disabled={!canUpload}
            />
            <p className="text-xs text-slate-500 mt-1">
              Transparency is valued. Disclosing standard AI coding assistant usage does not penalize your score.
            </p>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={handleFinalize}
              disabled={!canUpload || isPending}
              className="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {isPending ? "Submitting..." : "Submit Final Project for Scoring"}
            </button>
          </div>
        </div>
      )}

      {/* Post-submission Review & Component Score Overview */}
      {isSubmitted && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Submission Status & Component Scores
          </h2>
          <p className="text-sm text-slate-600">
            Your project has been submitted. Automatic components (A1, B1, B3) are scored by the grader worker.
            Methodology, code reproducibility, and write-up (A2, A3, B2, C, D) are assigned to independent reviewers.
          </p>

          {componentScores.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              {componentScores.map((c) => (
                <div key={c.component} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-xs font-semibold text-slate-500">{c.component}</div>
                  <div className="text-lg font-bold text-slate-800">
                    {c.points} / {c.max_points}
                  </div>
                  <div className="text-xs text-slate-400 capitalize">{c.source}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-blue-50 text-blue-800 rounded-lg text-sm">
              Grading jobs are currently processing in the worker queue. Component scores will appear once finished.
            </div>
          )}

          {attempt.score !== null && (
            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-emerald-800 uppercase">Stage 3 Total Score</span>
                <div className="text-2xl font-bold text-emerald-900">{attempt.score} / 100 Points</div>
              </div>
              <span className="text-sm font-semibold text-emerald-800">
                {attempt.score >= 60 ? "Stage 3 Passed" : "Under Evaluation"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
