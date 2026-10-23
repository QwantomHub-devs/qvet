import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/database";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: Profile | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    profile = (data as Profile | null) ?? null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user?.email} fullName={profile?.full_name} role={profile?.role} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 space-y-10">
        <section className="space-y-4">
          <span className="inline-block rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            AI · IoT · Robotics
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Rigorous, Verifiable Engineering Certification
          </h1>
          <p className="max-w-2xl text-base text-slate-700">
            Complete five structured assessment stages—from identity check and foundation screen to
            timed technical exam, practical project, and live technical defence—to earn a scored
            credential trusted by employers worldwide.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            {user ? (
              <Link
                href={
                  profile?.role === "admin"
                    ? "/admin"
                    : profile?.role === "reviewer"
                      ? "/reviewer"
                      : "/dashboard"
                }
                className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Go to {profile?.role === "admin" ? "Admin Console" : "Your Dashboard"}
              </Link>
            ) : (
              <>
                <Link
                  href="/register"
                  className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Apply as a Candidate
                </Link>
                <Link
                  href="/login"
                  className="rounded border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="pipeline-heading" className="space-y-4">
          <h2 id="pipeline-heading" className="text-lg font-bold text-slate-900">
            Five-Stage Assessment Pipeline
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
            {[
              {
                stage: "Stage 0",
                title: "Identity & Track",
                detail: "Profile, portfolio check, consent, and government ID verification.",
              },
              {
                stage: "Stage 1 (15%)",
                title: "Foundation Screen",
                detail: "Written explanation, 2-minute scenario video, and 15 logic questions.",
              },
              {
                stage: "Stage 2 (25%)",
                title: "Technical Exam",
                detail: "40 randomized domain questions in 60 minutes. One question at a time.",
              },
              {
                stage: "Stage 3 (35%)",
                title: "Practical Project",
                detail: "5-hour timed real-world engineering scenario graded on hidden test data.",
              },
              {
                stage: "Stage 4 (25%)",
                title: "Live Defence",
                detail: "40-minute live code walkthrough, probing, and live modification.",
              },
            ].map((item) => (
              <div
                key={item.stage}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs"
              >
                <p className="text-xs font-bold uppercase text-slate-500">{item.stage}</p>
                <h3 className="mt-1 text-sm font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-xs text-slate-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
