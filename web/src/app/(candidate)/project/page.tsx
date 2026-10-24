import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ProjectWorkspaceClient from "@/components/ProjectWorkspaceClient";
import { getProjectStatusAction } from "@/actions/project";
import type { Application } from "@/lib/types/database";

export default async function CandidateProjectPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: appData } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const application = (appData as Application | null) ?? null;
  if (!application) {
    redirect("/dashboard");
  }

  const allowedStatuses = new Set([
    "s2_passed",
    "s3_open",
    "s3_grading",
    "s3_review",
    "s3_passed",
    "s3_failed",
    "s4_scheduled",
    "s4_done",
    "s4_passed",
    "s4_failed",
    "certified",
  ]);

  if (!allowedStatuses.has(application.status)) {
    redirect("/dashboard");
  }

  // If candidate just passed Stage 2, transition to s3_open
  if (application.status === "s2_passed") {
    await supabase.rpc("advance_status", {
      p_application_id: application.id,
      p_to_status: "s3_open",
      p_reason: "Candidate entered Stage 3 Practical Project workspace",
    });
  }

  const statusRes = await getProjectStatusAction(application.id);

  return (
    <div className="py-8 px-4">
      <ProjectWorkspaceClient
        applicationId={application.id}
        initialAttempt={statusRes.attempt}
        initialScenario={statusRes.scenario}
        initialSubmissions={statusRes.submissions}
        initialPracticeJobs={statusRes.practiceJobs}
        initialFinalJobs={statusRes.finalJobs}
        initialComponentScores={statusRes.componentScores}
        initialStarterKitUrl={statusRes.starterKitUrl}
        initialRemainingSeconds={statusRes.remainingSeconds}
      />
    </div>
  );
}
