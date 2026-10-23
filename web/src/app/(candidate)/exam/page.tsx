import { redirect } from "next/navigation";
import { ExamRunnerClient } from "@/components/ExamRunnerClient";
import { Navbar } from "@/components/Navbar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Application, Profile, StageResult } from "@/lib/types/database";

export default async function CandidateExamPage() {
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

  if (!profile || profile.role !== "candidate") {
    redirect("/dashboard");
  }

  const { data: appData } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const application = appData as Application | null;

  if (!application) {
    redirect("/dashboard");
  }

  const { data: stageResultData } = await supabase
    .from("stage_results")
    .select("*")
    .eq("application_id", application.id)
    .eq("stage", 2)
    .maybeSingle();

  const stageResult = (stageResultData as StageResult | null) ?? null;

  if (application.status !== "s2_open" && !stageResult) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user.email} fullName={profile.full_name} role={profile.role} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <ExamRunnerClient applicationId={application.id} initialStageResult={stageResult} />
      </main>
    </div>
  );
}

