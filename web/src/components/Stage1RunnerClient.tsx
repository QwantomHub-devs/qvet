"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import {
  startStage1PartAction,
  autosaveStage1TextAction,
  submitStage1TextAction,
  submitStage1VideoAction,
  startOrResumeStage1LogicExamAction,
} from "@/actions/stage1";
import {
  getCurrentQuestionAction,
  submitExamAnswerAction,
  finishExamAttemptAction,
  logIntegrityEventAction,
} from "@/actions/exam";
import {
  DOMAIN_LABELS,
  type Stage1Prompt,
  type Stage1Response,
  type ServedQuestion,
  type StageResult,
} from "@/lib/types/database";

interface Stage1RunnerClientProps {
  applicationId: string;
  initialTextResponse: Stage1Response | null;
  initialTextPrompt: Stage1Prompt | null;
  initialTextRemainingSeconds: number;
  initialVideoResponse: Stage1Response | null;
  initialVideoPrompt: Stage1Prompt | null;
  initialVideoRemainingSeconds: number;
  initialLogicAttempt: {
    id: string;
    status: string;
    current_index: number;
    total_questions: number;
    remaining_seconds: number;
    score: number | null;
  } | null;
  initialLogicQuestion: ServedQuestion | null;
  stage1Result: StageResult | null;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function countWordsClient(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function Stage1RunnerClient({
  applicationId,
  initialTextResponse,
  initialTextPrompt,
  initialTextRemainingSeconds,
  initialVideoResponse,
  initialVideoPrompt,
  initialVideoRemainingSeconds,
  initialLogicAttempt,
  initialLogicQuestion,
  stage1Result,
}: Stage1RunnerClientProps) {
  const [activeTab, setActiveTab] = useState<"partA" | "partB" | "partC">("partA");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Part A (Written explanation) state
  const [textResponse, setTextResponse] = useState<Stage1Response | null>(initialTextResponse);
  const [textPrompt, setTextPrompt] = useState<Stage1Prompt | null>(initialTextPrompt);
  const [draftText, setDraftText] = useState<string>(initialTextResponse?.text ?? "");
  const [textRemainingSeconds, setTextRemainingSeconds] = useState<number>(
    initialTextRemainingSeconds
  );
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(
    initialTextResponse?.last_saved_at
      ? new Date(initialTextResponse.last_saved_at).toLocaleTimeString()
      : null
  );
  const latestDraftRef = useRef<string>(initialTextResponse?.text ?? "");

  // Part B (Recorded video) state
  const [videoResponse, setVideoResponse] = useState<Stage1Response | null>(initialVideoResponse);
  const [videoPrompt, setVideoPrompt] = useState<Stage1Prompt | null>(initialVideoPrompt);
  const [videoRemainingSeconds, setVideoRemainingSeconds] = useState<number>(
    initialVideoRemainingSeconds
  );
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);
  const [fallbackFile, setFallbackFile] = useState<File | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Part C (15-item logic exam) state
  const [logicAttempt, setLogicAttempt] = useState(initialLogicAttempt);
  const [logicQuestion, setLogicQuestion] = useState<ServedQuestion | null>(initialLogicQuestion);
  const [logicRemainingSeconds, setLogicRemainingSeconds] = useState<number>(
    initialLogicQuestion?.remaining_seconds ?? initialLogicAttempt?.remaining_seconds ?? 0
  );
  const [selectedOption, setSelectedOption] = useState<string>("");

  useEffect(() => {
    latestDraftRef.current = draftText;
  }, [draftText]);

  // Part A countdown timer
  useEffect(() => {
    if (!textResponse || textResponse.locked || textRemainingSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setTextRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [textResponse, textRemainingSeconds]);

  // Part A automatic 10-second autosave
  useEffect(() => {
    if (!textResponse || textResponse.locked || textRemainingSeconds <= 0) return;

    const autosaveInterval = window.setInterval(async () => {
      const res = await autosaveStage1TextAction(applicationId, latestDraftRef.current);
      if (res.ok) {
        if (res.lastSavedAt) {
          setLastSavedLabel(new Date(res.lastSavedAt).toLocaleTimeString());
        }
        if (typeof res.remainingSeconds === "number") {
          setTextRemainingSeconds(res.remainingSeconds);
        }
      } else if (res.locked) {
        setTextResponse((prev) => (prev ? { ...prev, locked: true } : prev));
      }
    }, 10000);

    return () => window.clearInterval(autosaveInterval);
  }, [applicationId, textResponse, textRemainingSeconds]);

  // Part B countdown timer
  useEffect(() => {
    if (!videoResponse || videoResponse.locked || videoRemainingSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setVideoRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [videoResponse, videoRemainingSeconds]);

  // Part B recording duration timer (auto-stops at 120 seconds)
  useEffect(() => {
    if (!isRecording) return;
    const recInterval = window.setInterval(() => {
      setRecordingSeconds((prev) => {
        if (prev >= 119) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
          }
          setIsRecording(false);
          return 120;
        }
        return prev + 1;
      });
    }, 1000);
    return () => window.clearInterval(recInterval);
  }, [isRecording]);

  // Part C countdown timer & auto-submit on expiry
  useEffect(() => {
    if (!logicAttempt || logicAttempt.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      setLogicRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          startTransition(async () => {
            await finishExamAttemptAction(logicAttempt.id);
            setLogicAttempt((curr) => (curr ? { ...curr, status: "timed_out" } : curr));
            setLogicQuestion(null);
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [logicAttempt]);

  // Part C integrity listeners while logic exam is in progress
  useEffect(() => {
    if (!logicAttempt || logicAttempt.status !== "in_progress") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void logIntegrityEventAction(logicAttempt.id, "tab_hidden", {
          stage: 1,
          question_index: logicQuestion?.question_index ?? 0,
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [logicAttempt, logicQuestion?.question_index]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function handleStartPartA() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await startStage1PartAction(applicationId, "text");
      if (!res.ok || !res.response || !res.prompt) {
        setErrorMessage(res.error ?? "Failed to start Part A.");
        return;
      }
      setTextResponse(res.response);
      setTextPrompt(res.prompt);
      setDraftText(res.response.text ?? "");
      setTextRemainingSeconds(res.remainingSeconds ?? 900);
    });
  }

  function handleManualSaveText() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await autosaveStage1TextAction(applicationId, draftText);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Could not save draft.");
        return;
      }
      if (res.lastSavedAt) {
        setLastSavedLabel(new Date(res.lastSavedAt).toLocaleTimeString());
      }
      setStatusBanner("Draft saved.");
    });
  }

  function handleSubmitPartA() {
    setErrorMessage(null);
    setStatusBanner(null);
    startTransition(async () => {
      const res = await submitStage1TextAction(applicationId, draftText);
      if (!res.ok || !res.response) {
        setErrorMessage(res.error ?? "Failed to submit Part A.");
        return;
      }
      setTextResponse(res.response);
      setStatusBanner("Part A submitted and locked. Assigned to two blind reviewers.");
    });
  }

  function handleStartPartB() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await startStage1PartAction(applicationId, "video");
      if (!res.ok || !res.response || !res.prompt) {
        setErrorMessage(res.error ?? "Failed to start Part B.");
        return;
      }
      setVideoResponse(res.response);
      setVideoPrompt(res.prompt);
      setVideoRemainingSeconds(res.remainingSeconds ?? 600);
    });
  }

  async function handleStartCameraRecording() {
    setCameraError(null);
    setErrorMessage(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setCameraError(
          "Browser video recording is not supported on this device. Please use the file upload option below."
        );
        return;
      }

      // Low-resolution (~480p) stream so a 2-minute clip stays well under 25 MB
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 854 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 24 },
        },
        audio: true,
      });

      mediaStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play().catch(() => undefined);
      }

      const preferredMime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : MediaRecorder.isTypeSupported("video/mp4")
            ? "video/mp4"
            : "";

      const recorder = new MediaRecorder(stream, {
        ...(preferredMime ? { mimeType: preferredMime } : {}),
        videoBitsPerSecond: 450_000, // ~3.4 MB per minute at 480p
      });

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(blob);
        setFallbackFile(null);
        const url = URL.createObjectURL(blob);
        setRecordedPreviewUrl(url);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
      };

      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecordedBlob(null);
      setRecordedPreviewUrl(null);
      recorder.start(1000);
      setIsRecording(true);
    } catch {
      setCameraError(
        "Could not access camera or microphone. You can upload a short video file (max 2 minutes, 25 MB) using the fallback uploader below."
      );
    }
  }

  function handleStopCameraRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function handleSubmitPartB() {
    setErrorMessage(null);
    setStatusBanner(null);

    let fileToUpload: File | null = fallbackFile;
    if (!fileToUpload && recordedBlob) {
      const cleanMime = recordedBlob.type.split(";")[0]?.trim() || "video/webm";
      const ext = cleanMime === "video/mp4" ? "mp4" : "webm";
      fileToUpload = new File([recordedBlob], `stage1-recorded.${ext}`, {
        type: cleanMime,
      });
    }

    if (!fileToUpload) {
      setErrorMessage("Please record a video or select a video file first.");
      return;
    }

    const formData = new FormData();
    formData.set("application_id", applicationId);
    formData.set("duration_seconds", String(recordingSeconds > 0 ? recordingSeconds : 120));
    formData.set("video_file", fileToUpload);

    startTransition(async () => {
      const res = await submitStage1VideoAction(formData);
      if (!res.ok || !res.response) {
        setErrorMessage(res.error ?? "Failed to upload video response.");
        return;
      }
      setVideoResponse(res.response);
      setStatusBanner("Part B video uploaded and locked. Assigned to two blind reviewers.");
    });
  }

  function handleStartPartC() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await startOrResumeStage1LogicExamAction(applicationId);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Failed to start Part C logic test.");
        return;
      }
      setLogicAttempt({
        id: res.attemptId!,
        status: res.status ?? "in_progress",
        current_index: res.currentIndex ?? 0,
        total_questions: res.totalQuestions ?? 15,
        remaining_seconds: res.remainingSeconds ?? 1200,
        score: null,
      });
      setLogicQuestion(res.question ?? null);
      setLogicRemainingSeconds(res.remainingSeconds ?? 1200);
      setSelectedOption("");
    });
  }

  function handleSubmitLogicAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!logicAttempt || !logicQuestion) return;
    if (!selectedOption.trim()) {
      setErrorMessage("Please choose an option before locking your answer.");
      return;
    }

    setErrorMessage(null);
    startTransition(async () => {
      const res = await submitExamAnswerAction(
        logicAttempt.id,
        logicQuestion.question_id,
        selectedOption.trim()
      );
      if (!res.ok) {
        setErrorMessage(res.error ?? "Could not submit answer.");
        return;
      }
      setSelectedOption("");
      if (res.finished) {
        setLogicAttempt((curr) =>
          curr
            ? {
                ...curr,
                status: "submitted",
                current_index: curr.total_questions,
                score: res.stageResult?.percent ?? curr.score,
              }
            : curr
        );
        setLogicQuestion(null);
        setStatusBanner("Part C Logic & Numeracy completed and scored.");
        return;
      }
      const nextQRes = await getCurrentQuestionAction(logicAttempt.id);
      if (nextQRes.ok && nextQRes.question) {
        setLogicQuestion(nextQRes.question);
        setLogicRemainingSeconds(nextQRes.question.remaining_seconds);
        setLogicAttempt((curr) =>
          curr ? { ...curr, current_index: nextQRes.question!.question_index } : curr
        );
      }
    });
  }

  const wordCount = countWordsClient(draftText);
  const partADone = Boolean(textResponse?.locked);
  const partBDone = Boolean(videoResponse?.locked);
  const partCDone =
    logicAttempt?.status === "submitted" || logicAttempt?.status === "timed_out";

  return (
    <div className="space-y-6">
      {/* Header & Progress */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Stage 1 · Foundation Screen (15% of Overall Score · 60% Pass Minimum)
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">
              Communication, Engineering Judgment &amp; Logic Screen
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Dashboard
          </Link>
        </div>

        {/* Part selector tabs */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveTab("partA")}
            className={`rounded-lg border p-3.5 text-left transition ${
              activeTab === "partA"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Part A · Written (40%)</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  partADone
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-amber-500/20 text-amber-600"
                }`}
              >
                {partADone ? "Locked" : "15 min"}
              </span>
            </div>
            <p
              className={`mt-1 text-xs ${
                activeTab === "partA" ? "text-slate-300" : "text-slate-600"
              }`}
            >
              ~150-word explanation for a non-technical manager
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("partB")}
            className={`rounded-lg border p-3.5 text-left transition ${
              activeTab === "partB"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Part B · Video (30%)</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  partBDone
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-amber-500/20 text-amber-600"
                }`}
              >
                {partBDone ? "Locked" : "2-min clip"}
              </span>
            </div>
            <p
              className={`mt-1 text-xs ${
                activeTab === "partB" ? "text-slate-300" : "text-slate-600"
              }`}
            >
              480p browser recording or file upload fallback
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("partC")}
            className={`rounded-lg border p-3.5 text-left transition ${
              activeTab === "partC"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Part C · Logic (30%)</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  partCDone
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-amber-500/20 text-amber-600"
                }`}
              >
                {partCDone ? "Completed" : "15 items · 20m"}
              </span>
            </div>
            <p
              className={`mt-1 text-xs ${
                activeTab === "partC" ? "text-slate-300" : "text-slate-600"
              }`}
            >
              Patterns, probability &amp; reading data charts
            </p>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          {errorMessage}
        </div>
      )}

      {statusBanner && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {statusBanner}
        </div>
      )}

      {stage1Result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-5">
          <h2 className="text-base font-bold text-slate-900">
            Stage 1 Final Result: {Number(stage1Result.percent).toFixed(2)}% (
            {stage1Result.passed ? "PASSED" : "BELOW 60% MINIMUM"})
          </h2>
          <p className="mt-1 text-xs text-slate-700">
            Part A (40%): {stage1Result.details.part_a_percent ?? "—"}% · Part B (30%):{" "}
            {stage1Result.details.part_b_percent ?? "—"}% · Part C (30%):{" "}
            {stage1Result.details.part_c_percent ?? "—"}%
          </p>
        </div>
      )}

      {/* PART A: Written Explanation */}
      {activeTab === "partA" && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Part A: Written Explanation (15 Minutes · 40% of Stage 1)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Explain a technical concept to a non-technical manager in about 150 words. Autosaves
                every 10 seconds.
              </p>
            </div>
            {textResponse && !textResponse.locked && (
              <div
                aria-live="polite"
                className="rounded-md border border-slate-300 bg-slate-50 px-3.5 py-2 font-mono text-base font-bold text-slate-900"
              >
                {formatTime(textRemainingSeconds)} remaining
              </div>
            )}
          </div>

          {!textResponse ? (
            <div className="mt-6">
              <p className="text-sm text-slate-700">
                When you click start, the server assigns a rotating prompt and starts your 15-minute
                timer.
              </p>
              <button
                type="button"
                disabled={isPending}
                onClick={handleStartPartA}
                className="mt-4 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? "Starting Part A..." : "Start Part A (15-Minute Timer)"}
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {textPrompt && (
                <div className="rounded-md border border-blue-200 bg-blue-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                    Assigned Prompt: {textPrompt.title}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                    {textPrompt.prompt_text}
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="part-a-textarea"
                  className="block text-sm font-medium text-slate-900"
                >
                  Your Explanation (Target: ~150 words)
                </label>
                <textarea
                  id="part-a-textarea"
                  rows={8}
                  disabled={textResponse.locked || isPending}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Write your plain-English explanation here..."
                  className="mt-2 w-full rounded-md border border-slate-300 p-3 text-sm leading-relaxed text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    Word count: <strong className="text-slate-900">{wordCount}</strong> words (target
                    ~150 words)
                  </span>
                  <span>
                    {textResponse.locked
                      ? `Locked & submitted at ${
                          textResponse.submitted_at
                            ? new Date(textResponse.submitted_at).toLocaleTimeString()
                            : "deadline"
                        }`
                      : lastSavedLabel
                        ? `Last autosaved at ${lastSavedLabel}`
                        : "Autosaves every 10 seconds"}
                  </span>
                </div>
              </div>

              {!textResponse.locked && (
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleManualSaveText}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save Draft Now
                  </button>
                  <button
                    type="button"
                    disabled={isPending || wordCount < 5}
                    onClick={handleSubmitPartA}
                    className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isPending ? "Submitting..." : "Submit & Lock Part A"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* PART B: Recorded Video Scenario */}
      {activeTab === "partB" && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Part B: Recorded Video Scenario (10 Minutes · Max 2-Min Video · 30% of Stage 1)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Record a 2-minute response at low resolution (~480p, max 25 MB) or upload a short
                video file if your browser cannot record.
              </p>
            </div>
            {videoResponse && !videoResponse.locked && (
              <div
                aria-live="polite"
                className="rounded-md border border-slate-300 bg-slate-50 px-3.5 py-2 font-mono text-base font-bold text-slate-900"
              >
                {formatTime(videoRemainingSeconds)} remaining
              </div>
            )}
          </div>

          {!videoResponse ? (
            <div className="mt-6">
              <p className="text-sm text-slate-700">
                When you click start, the server reveals your work scenario prompt and starts your
                10-minute window to record and upload a 2-minute response.
              </p>
              <button
                type="button"
                disabled={isPending}
                onClick={handleStartPartB}
                className="mt-4 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? "Starting Part B..." : "Start Part B (10-Minute Window)"}
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {videoPrompt && (
                <div className="rounded-md border border-blue-200 bg-blue-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                    Assigned Video Scenario: {videoPrompt.title}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                    {videoPrompt.prompt_text}
                  </p>
                </div>
              )}

              {videoResponse.locked ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  Part B video response is locked and submitted ({videoResponse.duration_seconds ?? 120}
                  s, {Math.round((videoResponse.file_size_bytes ?? 0) / 1024)} KB). Sent to two blind
                  reviewers.
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Option 1: In-Browser 480p Recorder */}
                  <div className="rounded-lg border border-slate-200 p-4">
                    <h3 className="text-sm font-bold text-slate-900">
                      Option 1: Record in Browser (~480p, Max 2:00)
                    </h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Uses low bitrate so your video uploads reliably on slow connections.
                    </p>

                    {cameraError && (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        {cameraError}
                      </p>
                    )}

                    <div className="mt-3 overflow-hidden rounded-md bg-slate-950">
                      {recordedPreviewUrl ? (
                        <video
                          src={recordedPreviewUrl}
                          controls
                          className="aspect-video w-full"
                        />
                      ) : (
                        <video
                          ref={liveVideoRef}
                          muted
                          playsInline
                          className="aspect-video w-full"
                        />
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-700">
                        Clip length: {formatTime(recordingSeconds)} / 02:00
                      </span>
                      {!isRecording ? (
                        <button
                          type="button"
                          onClick={handleStartCameraRecording}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                        >
                          {recordedBlob ? "Re-record Video" : "Start Camera Recording"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopCameraRecording}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Stop Recording
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Option 2: File Upload Fallback */}
                  <div className="flex flex-col justify-between rounded-lg border border-slate-200 p-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Option 2: File Upload Fallback
                      </h3>
                      <p className="mt-1 text-xs text-slate-600">
                        If your browser or connection cannot record directly, record a 2-minute video
                        on your phone or laptop and upload the file here (WebM, MP4, or MOV, max 25
                        MB).
                      </p>

                      <div className="mt-4">
                        <label
                          htmlFor="video-fallback-input"
                          className="block text-xs font-medium text-slate-700"
                        >
                          Select video file (max 25 MB)
                        </label>
                        <input
                          id="video-fallback-input"
                          type="file"
                          accept="video/webm,video/mp4,video/quicktime"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            setFallbackFile(f);
                            if (f) {
                              setRecordedBlob(null);
                              setRecordedPreviewUrl(null);
                            }
                          }}
                          className="mt-1.5 block w-full text-xs text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                        />
                        {fallbackFile && (
                          <p className="mt-2 text-xs text-emerald-700">
                            Selected: {fallbackFile.name} (
                            {(fallbackFile.size / (1024 * 1024)).toFixed(2)} MB)
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 border-t border-slate-200 pt-4">
                      <button
                        type="button"
                        disabled={isPending || isRecording || (!recordedBlob && !fallbackFile)}
                        onClick={handleSubmitPartB}
                        className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {isPending
                          ? "Uploading & Locking Video..."
                          : "Upload & Lock Part B Video Response"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* PART C: 15 Logic & Numeracy Questions (Reusing Exam Engine) */}
      {activeTab === "partC" && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Part C: Logic &amp; Numeracy (15 Questions · 20 Minutes · 30% of Stage 1)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                One question at a time, no going back. Covers patterns, basic probability, and
                reading data charts.
              </p>
            </div>
            {logicAttempt?.status === "in_progress" && (
              <div
                aria-live="polite"
                className="rounded-md border border-slate-300 bg-slate-50 px-3.5 py-2 font-mono text-base font-bold text-slate-900"
              >
                {formatTime(logicRemainingSeconds)} remaining
              </div>
            )}
          </div>

          {!logicAttempt ? (
            <div className="mt-6">
              <p className="text-sm text-slate-700">
                When you click start, the exam engine draws 15 random questions across patterns,
                probability, and charts and starts your 20-minute server timer.
              </p>
              <button
                type="button"
                disabled={isPending}
                onClick={handleStartPartC}
                className="mt-4 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? "Starting Part C..." : "Start Part C Logic Exam (20 Minutes)"}
              </button>
            </div>
          ) : logicAttempt.status !== "in_progress" ? (
            <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Part C Logic &amp; Numeracy exam is complete ({logicAttempt.status}). Score:{" "}
              <strong>
                {logicAttempt.score !== null ? `${Number(logicAttempt.score).toFixed(2)}%` : "Scored"}
              </strong>
              .
            </div>
          ) : logicQuestion ? (
            <form onSubmit={handleSubmitLogicAnswer} className="mt-5 space-y-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                <span>
                  Question {logicQuestion.question_index + 1} of {logicQuestion.total_questions}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                  {DOMAIN_LABELS[logicQuestion.domain] ?? logicQuestion.domain}
                </span>
              </div>

              <div className="prose prose-slate max-w-none text-base font-medium text-slate-900">
                {logicQuestion.stem}
              </div>

              <fieldset className="space-y-2.5">
                <legend className="sr-only">Choose one answer</legend>
                {(logicQuestion.options ?? []).map((opt) => {
                  const checked = selectedOption === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 text-sm transition ${
                        checked
                          ? "border-slate-900 bg-slate-900/5 font-medium text-slate-900"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="logicOption"
                        value={opt.id}
                        checked={checked}
                        onChange={() => setSelectedOption(opt.id)}
                        disabled={isPending}
                        className="mt-0.5 h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <span>
                        <strong className="mr-1.5 font-semibold">{opt.id}.</strong>
                        {opt.text}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">
                  Locked once submitted. You cannot return to earlier questions.
                </p>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending
                    ? "Locking Answer..."
                    : logicQuestion.question_index + 1 === logicQuestion.total_questions
                      ? "Lock Final Answer & Finish Part C"
                      : "Lock Answer & Next Question"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      )}
    </div>
  );
}
