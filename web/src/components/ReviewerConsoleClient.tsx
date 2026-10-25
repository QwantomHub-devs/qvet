"use client";

import { useState, useTransition } from "react";
import {
  getReviewerVideoSignedUrlAction,
  submitReviewAction,
  getReviewerQueueAction,
} from "@/actions/reviewer";
import { TRACK_LABELS, type ReviewerQueueItem } from "@/lib/types/database";

interface ReviewerConsoleClientProps {
  initialItems: ReviewerQueueItem[];
}

export function ReviewerConsoleClient({ initialItems }: ReviewerConsoleClientProps) {
  const [items, setItems] = useState<ReviewerQueueItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.assignment_id ?? null
  );
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Per-assignment draft scores & comments: { [assignmentId]: { [criterionId]: { score: number, comment: string } } }
  const [draftScores, setDraftScores] = useState<
    Record<string, Record<string, { score: number; comment: string }>>
  >({});

  // Signed video URLs per assignmentId
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});

  const selectedItem = items.find((i) => i.assignment_id === selectedId) ?? null;

  function setCriterionScore(assignmentId: string, criterionId: string, score: number) {
    setDraftScores((prev) => ({
      ...prev,
      [assignmentId]: {
        ...(prev[assignmentId] ?? {}),
        [criterionId]: {
          score,
          comment: prev[assignmentId]?.[criterionId]?.comment ?? "",
        },
      },
    }));
  }

  function setCriterionComment(assignmentId: string, criterionId: string, comment: string) {
    setDraftScores((prev) => ({
      ...prev,
      [assignmentId]: {
        ...(prev[assignmentId] ?? {}),
        [criterionId]: {
          score: prev[assignmentId]?.[criterionId]?.score ?? 0,
          comment,
        },
      },
    }));
  }

  function handleLoadVideo(assignmentId: string) {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await getReviewerVideoSignedUrlAction(assignmentId);
      if (!res.ok || !res.signedUrl) {
        setErrorMessage(res.error ?? "Failed to load signed video playback link.");
        return;
      }
      setVideoUrls((prev) => ({ ...prev, [assignmentId]: res.signedUrl! }));
    });
  }

  function handleSubmitReview(item: ReviewerQueueItem) {
    if (!item.rubric) return;
    setErrorMessage(null);
    setStatusMessage(null);

    const assignmentDrafts = draftScores[item.assignment_id] ?? {};
    const payloadScores: Array<{ criterion_id: string; score: number; comment?: string }> = [];

    for (const crit of item.rubric.criteria) {
      const entry = assignmentDrafts[crit.id];
      if (!entry || entry.score < 1 || entry.score > 4) {
        setErrorMessage(
          `Please select a score (1 to 4) for "${crit.criterion}" before submitting.`
        );
        return;
      }
      payloadScores.push({
        criterion_id: crit.id,
        score: entry.score,
        comment: entry.comment.trim() || undefined,
      });
    }

    startTransition(async () => {
      const res = await submitReviewAction(item.assignment_id, payloadScores);
      if (!res.ok) {
        setErrorMessage(res.error ?? "Failed to submit review.");
        return;
      }

      const refreshed = await getReviewerQueueAction();
      if (refreshed.ok && refreshed.items) {
        setItems(refreshed.items);
      }

      const thirdNote = res.thirdReviewTriggered
        ? " Score difference > 1.0 point detected: a third blind reviewer has been automatically assigned."
        : "";
      setStatusMessage(
        `Review submitted (Your Average: ${res.avgScore?.toFixed(2)} / 4.00).${thirdNote}`
      );
    });
  }

  const pendingCount = items.filter((i) => i.status === "assigned").length;
  const submittedCount = items.filter((i) => i.status === "submitted").length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Blind Assessment Queue · No Candidate Names or Institutions Shown
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Reviewer Scoring Console</h1>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
              Pending: {pendingCount}
            </span>
            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-emerald-900">
              Submitted: {submittedCount}
            </span>
          </div>
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

      {statusMessage && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {statusMessage}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          No review assignments in your queue right now. When candidates submit Stage 1 written or
          video responses from other institutions, they will appear here automatically.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Queue List */}
          <aside className="space-y-2.5 lg:col-span-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Assigned Submissions ({items.length})
            </h2>
            {items.map((item) => {
              const isSelected = item.assignment_id === selectedId;
              return (
                <button
                  key={item.assignment_id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.assignment_id);
                    setErrorMessage(null);
                    setStatusMessage(null);
                  }}
                  className={`w-full rounded-lg border p-3.5 text-left transition ${
                    isSelected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="font-mono">{item.anonymous_candidate_ref}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        item.status === "submitted"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-500"
                      }`}
                    >
                      {item.status === "submitted"
                        ? `Scored (${item.avg_score}/4)`
                        : `Round ${item.review_round}`}
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-xs font-medium ${
                      isSelected ? "text-slate-200" : "text-slate-700"
                    }`}
                  >
                    {item.part === "s1_text"
                      ? "Stage 1 Part A · Written Explanation"
                      : item.part === "s1_video"
                      ? "Stage 1 Part B · Video Scenario"
                      : item.part === "s4_defence"
                      ? "Stage 4 · Live Technical Defence"
                      : "Stage 3 · Practical Project Review"}
                  </p>
                  <div
                    className={`mt-1.5 flex items-center justify-between text-[11px] ${
                      isSelected ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    <span>{TRACK_LABELS[item.track] ?? item.track}</span>
                    {item.is_third_review && (
                      <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Tie-Breaker #3
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Right Scoring Workspace */}
          <div className="lg:col-span-8">
            {selectedItem && (
              <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-800">
                        {selectedItem.anonymous_candidate_ref}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        {TRACK_LABELS[selectedItem.track]} · Reviewer Round{" "}
                        {selectedItem.review_round}
                        {selectedItem.is_third_review ? " (Third Tie-Breaker Review)" : ""}
                      </span>
                    </div>
                    <h2 className="mt-1.5 text-lg font-bold text-slate-900">
                      {selectedItem.prompt_title}
                    </h2>
                  </div>

                  <span
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                      selectedItem.status === "submitted"
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-amber-300 bg-amber-100 text-amber-900"
                    }`}
                  >
                    {selectedItem.status === "submitted"
                      ? `Submitted (Avg ${selectedItem.avg_score}/4.00)`
                      : "Awaiting Your Score"}
                  </span>
                </div>

                {/* Prompt shown to candidate */}
                <div className="rounded-md border border-blue-200 bg-blue-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                    Scenario / Prompt Given to Candidate
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-900">
                    {selectedItem.prompt_text}
                  </p>
                </div>

                {/* Candidate Work (Text, Video, or Live Defence) */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  {selectedItem.part === "s4_defence" ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-600">
                        <span>Live Technical Defence Interview</span>
                        {selectedItem.scheduled_at && (
                          <span className="text-slate-800 font-bold">
                            Scheduled: {new Date(selectedItem.scheduled_at).toLocaleString()}
                          </span>
                        )}
                      </div>

                      <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-900">
                              Meeting Video Link
                            </p>
                            <p className="text-sm font-mono text-indigo-950 truncate max-w-md">
                              {selectedItem.meeting_url || "Link will be provided before interview"}
                            </p>
                          </div>
                          {selectedItem.meeting_url && (
                            <a
                              href={selectedItem.meeting_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
                            >
                              Open Video Call →
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <span className="block font-bold text-slate-900">10 min</span>
                          <span className="text-[11px] text-slate-500">Walkthrough</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <span className="block font-bold text-slate-900">10 min</span>
                          <span className="text-[11px] text-slate-500">Probing</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <span className="block font-bold text-slate-900">15 min</span>
                          <span className="text-[11px] text-slate-500">Live Change</span>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2">
                          <span className="block font-bold text-slate-900">5 min</span>
                          <span className="text-[11px] text-slate-500">Close</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-600">
                        <span>
                          Candidate Work (
                          {selectedItem.response_kind === "text"
                            ? `Written Explanation · ${selectedItem.word_count} words`
                            : `Recorded Video · ${selectedItem.duration_seconds ?? 120}s`}
                          )
                        </span>
                        {selectedItem.response_submitted_at && (
                          <span>
                            Submitted {new Date(selectedItem.response_submitted_at).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {selectedItem.response_kind === "text" ? (
                        <div className="mt-3 whitespace-pre-wrap rounded border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900">
                          {selectedItem.response_text || "(Empty response)"}
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {videoUrls[selectedItem.assignment_id] ? (
                            <video
                              src={videoUrls[selectedItem.assignment_id]}
                              controls
                              className="aspect-video w-full max-w-xl rounded border border-slate-300 bg-black"
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleLoadVideo(selectedItem.assignment_id)}
                              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              {isPending
                                ? "Generating Signed Playback Link..."
                                : "Load 5-Minute Signed Video Playback"}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Rubric & Anchor Descriptions */}
                {selectedItem.rubric && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        {selectedItem.rubric.title}
                      </h3>
                      {selectedItem.rubric.description && (
                        <p className="mt-0.5 text-xs text-slate-600">
                          {selectedItem.rubric.description}
                        </p>
                      )}
                    </div>

                    {selectedItem.rubric.criteria.map((crit) => {
                      const savedRow = selectedItem.my_scores.find(
                        (s) => s.criterion_id === crit.id
                      );
                      const draftRow = draftScores[selectedItem.assignment_id]?.[crit.id];
                      const activeScore =
                        selectedItem.status === "submitted"
                          ? (savedRow?.score ?? 0)
                          : (draftRow?.score ?? 0);
                      const activeComment =
                        selectedItem.status === "submitted"
                          ? (savedRow?.comment ?? "")
                          : (draftRow?.comment ?? "");

                      return (
                        <div
                          key={crit.id}
                          className="rounded-lg border border-slate-200 p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-slate-900">{crit.criterion}</h4>
                            <span className="text-xs font-semibold text-slate-600">
                              Scale {crit.scale_min} to {crit.scale_max}
                            </span>
                          </div>

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            {[1, 2, 3, 4].map((level) => {
                              const anchorText = crit.anchors[String(level)] ?? "";
                              const isChosen = activeScore === level;
                              return (
                                <button
                                  key={level}
                                  type="button"
                                  disabled={selectedItem.status === "submitted" || isPending}
                                  onClick={() =>
                                    setCriterionScore(selectedItem.assignment_id, crit.id, level)
                                  }
                                  className={`rounded-md border p-3 text-left text-xs transition ${
                                    isChosen
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                                  } disabled:cursor-default`}
                                >
                                  <div className="font-bold">Score {level}</div>
                                  <p
                                    className={`mt-1 leading-relaxed ${
                                      isChosen ? "text-slate-200" : "text-slate-600"
                                    }`}
                                  >
                                    {anchorText}
                                  </p>
                                </button>
                              );
                            })}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-600">
                              Optional Reviewer Note for {crit.criterion} (Never shown to
                              candidates)
                            </label>
                            <input
                              type="text"
                              disabled={selectedItem.status === "submitted" || isPending}
                              value={activeComment}
                              onChange={(e) =>
                                setCriterionComment(
                                  selectedItem.assignment_id,
                                  crit.id,
                                  e.target.value
                                )
                              }
                              placeholder="Optional note explaining why this anchor level fits..."
                              className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {selectedItem.status === "assigned" ? (
                      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
                        <p className="text-xs text-slate-500">
                          Peer reviewer scores are hidden until you submit your own independent
                          evaluation.
                        </p>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleSubmitReview(selectedItem)}
                          className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {isPending ? "Submitting Evaluation..." : "Submit & Lock Blind Review"}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Peer Calibration Summary (Visible After Submitting Your Score)
                        </h4>
                        {selectedItem.peer_reviews.length === 0 ? (
                          <p className="text-xs text-slate-600">
                            The other assigned reviewer has not submitted their score yet.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            {selectedItem.peer_reviews.map((pr) => (
                              <div
                                key={pr.assignment_id}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs"
                              >
                                <span className="font-semibold text-slate-700">
                                  Reviewer Round {pr.review_round}:
                                </span>{" "}
                                <strong className="font-mono text-slate-900">
                                  {pr.avg_score} / 4.00
                                </strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

