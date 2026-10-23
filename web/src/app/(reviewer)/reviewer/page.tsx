import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/database";

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
  if (!profile || profile.role !== "reviewer") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user.email} fullName={profile.full_name} role={profile.role} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
          <h1 className="text-xl font-bold text-slate-900">Blind Reviewer Console</h1>
          <p className="mt-2 text-sm text-slate-600">
            All candidate names, profiles, ID documents, and institutions are hidden from reviewers
            by Row Level Security. Assigned Stage 1 and Stage 3 review items will appear here in
            Milestone 3.
          </p>
        </div>
      </main>
    </div>
  );
}

