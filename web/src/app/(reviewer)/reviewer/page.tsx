import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { ReviewerConsoleClient } from "@/components/ReviewerConsoleClient";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile, ReviewerQueueItem } from "@/lib/types/database";

export default async function ReviewerConsolePage() {
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
  if (!profile || (profile.role !== "reviewer" && profile.role !== "admin")) {
    redirect("/dashboard");
  }

  const { data: queueData } = await supabase.rpc("get_reviewer_queue");
  const queueItems = (queueData as ReviewerQueueItem[] | null) ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user.email} fullName={profile.full_name} role={profile.role} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <ReviewerConsoleClient initialItems={queueItems} />
      </main>
    </div>
  );
}
