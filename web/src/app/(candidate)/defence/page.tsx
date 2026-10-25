import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Stage4BookingClient } from "@/components/Stage4BookingClient";
import type { Application, Stage4Booking, StageResult } from "@/lib/types/database";

export default async function CandidateDefencePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load candidate application
  const { data: application, error: appErr } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (appErr || !application) {
    redirect("/dashboard");
  }

  // Check stage readiness (must be s3_passed or in Stage 4)
  const allowedStatuses = [
    "s3_passed",
    "s4_scheduled",
    "s4_done",
    "s4_passed",
    "s4_failed",
    "certified",
  ];
  if (!allowedStatuses.includes(application.status)) {
    redirect("/dashboard");
  }

  // Load Stage 4 booking if already scheduled
  const { data: booking } = await supabase
    .from("stage4_bookings")
    .select("*")
    .eq("application_id", application.id)
    .maybeSingle();

  // Load Stage 4 result if completed
  const { data: stage4Result } = await supabase
    .from("stage_results")
    .select("*")
    .eq("application_id", application.id)
    .eq("stage", 4)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <Stage4BookingClient
        application={application as Application}
        booking={(booking as Stage4Booking) ?? null}
        stage4Result={(stage4Result as StageResult) ?? null}
      />
    </div>
  );
}
