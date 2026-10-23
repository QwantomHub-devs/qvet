"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState, useTransition } from "react";
import {
  finishExamAttemptAction,
  getCurrentQuestionAction,
  logIntegrityEventAction,
  startOrResumeExamAction,
  submitExamAnswerAction,
} from "@/actions/exam";
import {
  DOMAIN_LABELS,
  type ServedQuestion,
  type StageResult,
} from "@/lib/types/database";

interface ExamRunnerClientProps {
  applicationId: string;
  initialStageResult: StageResult | null;
}

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function ExamRunnerClient({
  applicationId,
  initialStageResult,
}: ExamRunnerClientProps) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string>("");
  const [stageResult, setStageResult] = useState<StageResult | null>(initialStageResult);
  const [error, setError] = useState<string | null>(null);
  const [integrityCount, setIntegrityCount] = useState<number>(0);
  const [isPending, startTransition] = useTransition();

  const loadCurrentQuestion = useCallback(async (activeAttemptId: string) => {
    const qRes = await getCurrentQuestionAction(activeAttemptId);
    if (!qRes.ok || !qRes.question) {
      // Check if deadline expired or exam finished
      const finRes = await finishExamAttemptAction(activeAttemptId);
      if (finRes.ok && finRes.stageResult) {
        setStageResult(finRes.stageResult);
        setQuestion(null);
        return;
      }
      setError(qRes.error ?? "Could not load the current question.");
      return;
    }
    setQuestion(qRes.question);
    setRemainingSeconds(qRes.question.remaining_seconds);
    setSelectedAnswer("");
  }, []);

  // Automatically resume or start when entering the exam runner if not already finished
  useEffect(() => {
    if (stageResult) return;
    startTransition(async () => {
      const startRes = await startOrResumeExamAction(applicationId);
      if (!startRes.ok) {
        setError(startRes.error ?? "Could not start the exam.");
        return;
      }
      if (startRes.stageResult) {
        setStageResult(startRes.stageResult);
        return;
      }
      if (startRes.attemptId) {
        setAttemptId(startRes.attemptId);
        setRemainingSeconds(startRes.remainingSeconds ?? 0);
        await loadCurrentQuestion(startRes.attemptId);
      }
    });
  }, [applicationId, stageResult, loadCurrentQuestion]);

  // Server-synced countdown timer & automatic deadline submission
  useEffect(() => {
    if (!attemptId || !question || stageResult) return;

    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          startTransition(async () => {
            const fin = await finishExamAttemptAction(attemptId);
            if (fin.ok && fin.stageResult) {
              setStageResult(fin.stageResult);
              setQuestion(null);
            }
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [attemptId, question, stageResult]);

  // Browser integrity telemetry: log tab_hidden and fullscreen_exit (flags only, never auto-fails)
  useEffect(() => {
    if (!attemptId || stageResult) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden" && attemptId) {
        setIntegrityCount((c) => c + 1);
        void logIntegrityEventAction(attemptId, "tab_hidden", {
          at_client: new Date().toISOString(),
        });
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement && attemptId) {
        setIntegrityCount((c) => c + 1);
        void logIntegrityEventAction(attemptId, "fullscreen_exit", {
          at_client: new Date().toISOString(),
        });
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [attemptId, stageResult]);

  function handleAnswerSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attemptId || !question) return;
    if (!selectedAnswer.trim()) {
      setError("Please select or enter an answer before locking it.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await submitExamAnswerAction(
        attemptId,
        question.question_id,
        selectedAnswer.trim()
      );
      if (!res.ok) {
        // If deadline passed during submission, load final result
        const fin = await finishExamAttemptAction(attemptId);
        if (fin.ok && fin.stageResult) {
          setStageResult(fin.stageResult);
          setQuestion(null);
          return;
        }
        setError(res.error ?? "Failed to submit answer.");
        return;
      }

      if (res.finished && res.stageResult) {
        setStageResult(res.stageResult);
        setQuestion(null);
        return;
      }

      await loadCurrentQuestion(attemptId);
    });
  }

  if (stageResult) {
    const domainScores = stageResult.details?.domain_scores ?? {};
    return (
      <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Stage 2: Technical Exam</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Exam Completed — {stageResult.percent}% (
              {stageResult.passed ? "Passed" : "Did Not Pass"})
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Correct answers: {stageResult.raw_score} of{" "}
              {stageResult.details?.total_questions ?? 40} (Minimum to pass: 60%)
            </p>
          </div>
          <span
            className={`rounded border px-3 py-1.5 text-sm font-bold ${
              stageResult.passed
                ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                : "border-red-300 bg-red-100 text-red-900"
            }`}
          >
            {stageResult.passed ? "PASSED (Stage 3 Unlocked)" : "NOT PASSED"}
          </span>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Per-Domain Score Breakdown
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(domainScores).map(([domain, stats]) => (
              <div
                key={domain}
                className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 p-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {DOMAIN_LABELS[domain] ?? domain}
                  </p>
                  <p className="text-xs text-slate-600">
                    {stats.correct} / {stats.total} correct
                  </p>
                </div>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {stats.percent}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Link
            href="/dashboard"
            className="inline-block rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Return to Candidate Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar: question progress and server-enforced timer */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">Stage 2: Technical Exam</p>
          <p className="text-base font-bold text-slate-900">
            {question
              ? `Question ${question.question_index + 1} of ${question.total_questions}`
              : "Loading exam session..."}
          </p>
          <p className="text-xs text-slate-600">
            One question at a time. Answers lock on submit; you cannot go back.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {integrityCount > 0 && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
              Focus events logged: {integrityCount}
            </span>
          )}
          <div
            aria-live="polite"
            className={`rounded border px-4 py-2 font-mono text-lg font-bold ${
              remainingSeconds < 300
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-slate-300 bg-slate-100 text-slate-900"
            }`}
          >
            Time Remaining: {formatSeconds(remainingSeconds)}
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900"
        >
          {error}
        </div>
      )}

      {question && (
        <form
          onSubmit={handleAnswerSubmit}
          className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-100 px-2.5 py-1 font-semibold text-slate-800">
              Domain: {DOMAIN_LABELS[question.domain] ?? question.domain}
            </span>
            <span className="rounded bg-slate-100 px-2.5 py-1 font-semibold uppercase text-slate-700">
              Type: {question.type.replace("_", " ")}
            </span>
          </div>

          <div className="space-y-3">
            <p className="text-base font-medium leading-relaxed text-slate-900">{question.stem}</p>

            {question.code_snippet && (
              <pre className="overflow-x-auto rounded border border-slate-300 bg-slate-900 p-4 font-mono text-xs text-slate-100">
                <code>{question.code_snippet}</code>
              </pre>
            )}
          </div>

          {question.type === "numeric" ? (
            <div>
              <label htmlFor="numericAnswer" className="block text-sm font-medium text-slate-800">
                Enter your numeric answer:
              </label>
              <input
                id="numericAnswer"
                type="number"
                step="any"
                required
                value={selectedAnswer}
                onChange={(e) => setSelectedAnswer(e.target.value)}
                placeholder="e.g. 0.80"
                className="mt-1 w-full max-w-xs rounded border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
              />
            </div>
          ) : (
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-medium text-slate-800">Select one option:</legend>
              {(question.options ?? []).map((opt) => (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer items-start gap-3 rounded border p-3.5 text-sm ${
                    selectedAnswer === opt.id
                      ? "border-slate-900 bg-slate-50 font-semibold text-slate-900"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="mcqOption"
                    value={opt.id}
                    checked={selectedAnswer === opt.id}
                    onChange={(e) => setSelectedAnswer(e.target.value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <strong className="mr-1.5">{opt.id}.</strong> {opt.text}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-xs text-slate-500">
              Connection loss safe: refreshing this page resumes at this exact question and timer.
            </span>
            <button
              type="submit"
              disabled={isPending || !selectedAnswer.trim()}
              className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending
                ? "Locking answer..."
                : question.question_index + 1 === question.total_questions
                  ? "Lock Final Answer & Submit Exam"
                  : "Lock Answer & Next Question →"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

