import { redirect } from "next/navigation";
import { IdUploadForm } from "@/components/IdUploadForm";
import { Navbar } from "@/components/Navbar";
import { OnboardingForm } from "@/components/OnboardingForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  STATUS_DESCRIPTIONS,
  TRACK_LABELS,
  type Application,
  type Cohort,
  type IdDocument,
  type Institution,
  type Profile,
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
  if (application) {
    const { data: idDocData } = await supabase
      .from("id_documents")
      .select("*")
      .eq("application_id", application.id)
      .eq("is_current", true)
      .maybeSingle();
    currentIdDoc = (idDocData as IdDocument | null) ?? null;
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

            {application.status === "approved" && (
              <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-950">
                <h2 className="font-bold">Stage 0 Complete — Identity Approved</h2>
                <p className="mt-1">
                  Your identity check is complete and your application has automatically advanced to
                  Stage 1 (Foundation Screen).
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
