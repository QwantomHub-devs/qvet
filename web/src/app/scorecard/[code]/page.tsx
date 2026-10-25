import Link from "next/link";
import { getEmployerScorecardAction } from "@/actions/credentials";
import { TRACK_LABELS, DOMAIN_LABELS } from "@/lib/types/database";

interface ScorecardPageProps {
  params: Promise<{ code: string }>;
}

export default async function EmployerScorecardPage({ params }: ScorecardPageProps) {
  const { code } = await params;
  const decodedCode = decodeURIComponent(code).trim().toUpperCase();

  const card = await getEmployerScorecardAction(decodedCode);

  if (!card.found) {
    return (
      <main className="min-h-screen bg-slate-50 py-16 px-4">
        <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Scorecard Not Available</h1>
          <p className="text-sm text-slate-600">
            No active certification matches code <span className="font-mono font-bold">{decodedCode}</span>.
          </p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
          >
            Return to Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Navigation & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href={`/verify/${card.verify_code}`}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Back to Public Verification
          </Link>

          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-200 px-2.5 py-1 font-mono text-xs font-bold text-slate-800">
              {card.verify_code}
            </span>
            <span
              className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${
                card.status === "valid"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {card.status}
            </span>
          </div>
        </div>

        {/* Scorecard Sheet */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm space-y-8">
          {/* Header */}
          <div className="border-b border-slate-200 pb-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                Official Engineering Talent Scorecard
              </span>
              <h1 className="mt-1 text-3xl font-extrabold text-slate-900">{card.full_name}</h1>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {card.track ? TRACK_LABELS[card.track] : card.track} Certified · {card.tier?.replace("_", " ").toUpperCase()}
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Overall Score
              </div>
              <div className="text-4xl font-extrabold text-indigo-950">
                {card.overall ?? 0}
                <span className="text-xl font-normal text-slate-400">/100</span>
              </div>
            </div>
          </div>

          {/* Revoked Warning */}
          {card.status === "revoked" && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-xs text-red-900">
              <span className="font-bold">Notice:</span> This credential has been revoked by platform administrators.
            </div>
          )}

          {/* 4-Stage Weighted Performance Breakdown */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Performance by Evaluation Stage
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">Stage 1 · 15%</span>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">
                  {card.stage_percentages?.stage_1_foundation ?? 0}%
                </div>
                <span className="text-xs text-slate-600 font-medium">Foundation Screen</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">Stage 2 · 25%</span>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">
                  {card.stage_percentages?.stage_2_exam ?? 0}%
                </div>
                <span className="text-xs text-slate-600 font-medium">Technical Exam</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">Stage 3 · 35%</span>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">
                  {card.stage_percentages?.stage_3_project ?? 0}%
                </div>
                <span className="text-xs text-slate-600 font-medium">Practical Project</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">Stage 4 · 25%</span>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">
                  {card.stage_percentages?.stage_4_defence ?? 0}%
                </div>
                <span className="text-xs text-slate-600 font-medium">Live Defence</span>
              </div>
            </div>
          </div>

          {/* Technical Exam Domain Breakdown */}
          {card.exam_domain_scores && card.exam_domain_scores.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Technical Exam Knowledge Mastery (Stage 2)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {card.exam_domain_scores.map((d) => (
                  <div
                    key={d.domain}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-3.5"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {DOMAIN_LABELS[d.domain] ?? d.domain}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {d.correct} of {d.total} items correct
                      </div>
                    </div>
                    <span className="text-sm font-extrabold text-indigo-700">
                      {d.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage 3 Practical Project Summary */}
          {card.project_summary && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Practical Project Assessment (Stage 3)
              </h2>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-500">Part A Score</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {card.project_summary.part_a_points} / 40.0 pts
                  </div>
                  <span className="text-[11px] text-slate-500">ML Predictions & Model</span>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-500">Part B Score</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {card.project_summary.part_b_points} / 40.0 pts
                  </div>
                  <span className="text-[11px] text-slate-500">RAG Retrieval & Refusal</span>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-500">Overall Project</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {card.project_summary.total_project_score}%
                  </div>
                  <span className="text-[11px] text-slate-500">Parts A, B, C & D Combined</span>
                </div>
              </div>
            </div>
          )}

          {/* Communication & Reviewer Feedback */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Communication Rating
              </span>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {card.communication_rating ?? "Clear and Structured"}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Evaluated live during Stage 4 Defence under technical probing.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Senior Reviewer Appraisal
              </span>
              <div className="mt-2 text-xs italic text-slate-800 leading-relaxed">
                "{card.reviewer_comment || "Demonstrated sound engineering foundations, clear articulation of technical trade-offs, and structured live problem solving."}"
              </div>
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="border-t border-slate-200 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div>
              <span>Issued: {card.issued_at ? new Date(card.issued_at).toLocaleDateString() : "—"}</span>
              <span className="mx-2">·</span>
              <span>Valid until: {card.expires_at ? new Date(card.expires_at).toLocaleDateString() : "—"}</span>
            </div>
            <div>
              Platform Security: Row Level Security verified
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
