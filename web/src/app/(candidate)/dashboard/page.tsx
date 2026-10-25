import Link from "next/link";
import { redirect } from "next/navigation";
import { IdUploadForm } from "@/components/IdUploadForm";
import { Navbar } from "@/components/Navbar";
import { OnboardingForm } from "@/components/OnboardingForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  DOMAIN_LABELS,
  STATUS_DESCRIPTIONS,
  TRACK_LABELS,
  type Application,
  type Cohort,
  type IdDocument,
  type Institution,
  type Profile,
  type StageResult,
} from "@/lib/types/database";

export default async function CandidateDashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const profile = profileData as Profile | null;
  if (!profile) {
    redirect("/login");
  }

  if (profile.role === "admin") {
    redirect("/admin");
  }
  if (profile.role === "reviewer") {
    redirect("/reviewer");
  }

  const { data: applicationData } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const application = (applicationData as Application | null) ?? null;

  const { data: institutionsData } = await supabase
    .from("institutions")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });
  const institutions = (institutionsData as Institution[] | null) ?? [];

  const { data: cohortsData } = await supabase
    .from("cohorts")
    .select("*")
    .order("created_at", { ascending: false });
  const cohorts = (cohortsData as Cohort[] | null) ?? [];

  let currentIdDoc: IdDocument | null = null;
  let stage1Result: StageResult | null = null;
  let stage2Result: StageResult | null = null;
  let stage3Result: StageResult | null = null;
  let stage4Result: StageResult | null = null;
  let credential: any = null;
  if (application) {
    const [
      { data: idDocData },
      { data: s1Data },
      { data: s2Data },
      { data: s3Data },
      { data: s4Data },
      { data: credData },
    ] = await Promise.all([
      supabase
        .from("id_documents")
        .select("*")
        .eq("application_id", application.id)
        .eq("is_current", true)
        .maybeSingle(),
      supabase
        .from("stage_results")
        .select("*")
        .eq("application_id", application.id)
        .eq("stage", 1)
        .maybeSingle(),
      supabase
        .from("stage_results")
        .select("*")
        .eq("application_id", application.id)
        .eq("stage", 2)
        .maybeSingle(),
      supabase
        .from("stage_results")
        .select("*")
        .eq("application_id", application.id)
        .eq("stage", 3)
        .maybeSingle(),
      supabase
        .from("stage_results")
        .select("*")
        .eq("application_id", application.id)
        .eq("stage", 4)
        .maybeSingle(),
      supabase
        .from("credentials")
        .select("*")
        .eq("application_id", application.id)
        .maybeSingle(),
    ]);
    currentIdDoc = (idDocData as IdDocument | null) ?? null;
    stage1Result = (s1Data as StageResult | null) ?? null;
    stage2Result = (s2Data as StageResult | null) ?? null;
    stage3Result = (s3Data as StageResult | null) ?? null;
    stage4Result = (s4Data as StageResult | null) ?? null;
    credential = credData ?? null;
  }

  const statusMeta = application ? STATUS_DESCRIPTIONS[application.status] : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user.email} fullName={profile.full_name} role={profile.role} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 space-y-6">
        {!application ? (
          <OnboardingForm profile={profile} institutions={institutions} cohorts={cohorts} />
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Active Track: {TRACK_LABELS[application.track]}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold text-slate-900">{statusMeta?.label}</h1>
                  <p className="mt-1 text-sm text-slate-700">{statusMeta?.summary}</p>
                </div>

                <span
                  className={`rounded border px-3 py-1 text-xs font-semibold ${statusMeta?.badgeClass}`}
                >
                  Status: {application.status}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-5">
                {[
                  { stage: 0, title: "Stage 0: Identity" },
                  { stage: 1, title: "Stage 1: Foundation" },
                  { stage: 2, title: "Stage 2: Exam" },
                  { stage: 3, title: "Stage 3: Project" },
                  { stage: 4, title: "Stage 4: Defence" },
                ].map((item) => {
                  const isCompleted = application.current_stage > item.stage;
                  const isCurrent = application.current_stage === item.stage;
                  return (
                    <div
                      key={item.stage}
                      className={`rounded border p-3 text-xs ${
                        isCompleted
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : isCurrent
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      <p className="font-bold">{item.title}</p>
                      <p className="mt-1">
                        {isCompleted ? "Passed" : isCurrent ? "Current Stage" : "Locked"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {(application.status === "registered" || application.status === "rejected") && (
              <IdUploadForm
                applicationId={application.id}
                registeredFullName={profile.full_name}
                isRejected={application.status === "rejected"}
                rejectionReason={currentIdDoc?.rejection_reason ?? null}
              />
            )}

            {application.status === "id_pending" && currentIdDoc && (
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
                <h2 className="font-bold">ID Document Submitted</h2>
                <p className="mt-1">
                  We received your ID file ({Math.round(currentIdDoc.file_size_bytes / 1024)} KB,{" "}
                  {currentIdDoc.mime_type}) on {new Date(currentIdDoc.created_at).toLocaleString()}.
                  An administrator will verify your document and unlock Stage 1.
                </p>
              </section>
            )}

            {(application.status === "approved" || application.status === "s1_open") && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Stage 1: Foundation Screen (45 Minutes Total · 15% of Overall Score)
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Complete all three parts to advance to Stage 2: Part A (15-min written
                    explanation with 10-second autosave), Part B (2-minute recorded video scenario
                    with file-upload fallback), and Part C (15 logic &amp; numeracy questions).
                  </p>
                </div>
                <Link
                  href="/stage1"
                  className="inline-block rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Open Stage 1 Foundation Screen →
                </Link>
              </section>
            )}

            {stage1Result && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Stage 1 Foundation Screen Result: {stage1Result.percent}%
                    </h2>
                    <p className="text-xs text-slate-600">
                      Part A (40%): {stage1Result.details?.part_a_percent ?? "—"}% · Part B (30%):{" "}
                      {stage1Result.details?.part_b_percent ?? "—"}% · Part C (30%):{" "}
                      {stage1Result.details?.part_c_percent ?? "—"}% · Minimum to pass: 60%
                    </p>
                  </div>
                  <span
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                      stage1Result.passed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-red-300 bg-red-100 text-red-900"
                    }`}
                  >
                    {stage1Result.passed ? "Passed" : "Did Not Pass"}
                  </span>
                </div>
              </section>
            )}

            {application.status === "s2_open" && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Stage 2: Technical Exam (60 Minutes · 40 Questions)
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Questions are drawn at random across your track domains and served one at a time.
                    Once you submit an answer, it is locked and you cannot return to previous
                    questions. If your connection drops, refresh or reopen the exam to resume at the
                    same question with your remaining time.
                  </p>
                </div>
                <Link
                  href="/exam"
                  className="inline-block rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Start or Resume Technical Exam →
                </Link>
              </section>
            )}

            {stage2Result && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Stage 2 Technical Exam Result: {stage2Result.percent}%
                    </h2>
                    <p className="text-xs text-slate-600">
                      Score: {stage2Result.raw_score} /{" "}
                      {stage2Result.details?.total_questions ?? 40} · Minimum to pass: 60%
                    </p>
                  </div>
                  <span
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                      stage2Result.passed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-red-300 bg-red-100 text-red-900"
                    }`}
                  >
                    {stage2Result.passed ? "Passed" : "Did Not Pass"}
                  </span>
                </div>

                {stage2Result.details?.domain_scores && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {Object.entries(stage2Result.details.domain_scores).map(([dom, stats]) => (
                      <div
                        key={dom}
                        className="rounded border border-slate-200 bg-slate-50 p-3 text-xs"
                      >
                        <p className="font-semibold text-slate-800">
                          {DOMAIN_LABELS[dom] ?? dom}
                        </p>
                        <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                          {stats.percent}% ({stats.correct}/{stats.total})
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {(application.status === "s2_passed" ||
              application.status === "s3_open" ||
              application.status.startsWith("s3_")) && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Stage 3: Practical Project (5 Hours · ML & RAG Challenge)
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Build a multi-class priority classifier on customer support tickets and a RAG pipeline over internal knowledge base articles. Includes starter dataset, up to 10 practice grading runs, and one optional 30-minute pause.
                  </p>
                </div>
                <Link
                  href="/project"
                  className="inline-block rounded bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm"
                >
                  Enter Practical Project Workspace →
                </Link>
              </section>
            )}

            {stage3Result && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Stage 3 Practical Project Result: {stage3Result.raw_score} / 100 Points
                    </h2>
                    <p className="text-xs text-slate-600">
                      Part A (ML): {stage3Result.details?.part_a_points ?? "—"}/40 · Part B (RAG):{" "}
                      {stage3Result.details?.part_b_points ?? "—"}/40 · Minimum: 60 pts (with ≥16 on Part A & B)
                    </p>
                  </div>
                  <span
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                      stage3Result.passed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-red-300 bg-red-100 text-red-900"
                    }`}
                  >
                    {stage3Result.passed ? "Passed" : "Did Not Pass"}
                  </span>
                </div>
              </section>
            )}

            {/* Stage 4: Live Technical Defence */}
            {(application.status === "s3_passed" ||
              application.status.startsWith("s4_")) && (
              <section className="rounded-lg border border-indigo-200 bg-white p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800 uppercase">
                    Stage 4 · 25% Weight
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Stage 4: Live Technical Defence (40 Minutes)
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    A one-on-one video call with a senior engineer. You will walk through your Stage 3 code, answer architectural trade-off questions, and implement a live modification.
                  </p>
                </div>
                <Link
                  href="/defence"
                  className="inline-block rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm"
                >
                  {application.status === "s3_passed"
                    ? "Book Defence Interview →"
                    : "View Defence Details & Meeting Link →"}
                </Link>
              </section>
            )}

            {/* Stage 4 Result */}
            {stage4Result && (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Stage 4 Live Defence Result: {stage4Result.raw_score} / 4.00 Avg ({stage4Result.percent}%)
                    </h2>
                    <p className="text-xs text-slate-600">
                      Minimum required: 2.50 / 4.00 and no score of 1 in understanding of own work.
                    </p>
                  </div>
                  <span
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                      stage4Result.passed
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-red-300 bg-red-100 text-red-900"
                    }`}
                  >
                    {stage4Result.passed ? "Passed" : "Did Not Pass"}
                  </span>
                </div>
              </section>
            )}

            {/* Issued Credential Banner */}
            {credential && (
              <section className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="rounded bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white uppercase tracking-wider">
                      Verified Credential Issued
                    </span>
                    <h2 className="mt-2 text-2xl font-extrabold text-emerald-950 capitalize">
                      {credential.tier?.replace("_", " ")} Engineer · Score: {credential.overall}/100
                    </h2>
                    <p className="text-xs text-emerald-900 mt-1">
                      Verification Code: <span className="font-mono font-bold">{credential.verify_code}</span> · Valid through{" "}
                      {new Date(credential.expires_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/verify/${credential.verify_code}`}
                      className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-900"
                    >
                      Public Verification Page →
                    </Link>
                    <Link
                      href={`/scorecard/${credential.verify_code}`}
                      className="rounded-lg border border-emerald-700 bg-white px-4 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-50"
                    >
                      Employer Scorecard →
                    </Link>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

