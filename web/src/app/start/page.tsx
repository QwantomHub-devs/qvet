import Link from "next/link";
import { verifySignedInviteToken } from "@/lib/qfellows/webhook-signer";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface StartPageProps {
  searchParams: Promise<{ app?: string; token?: string }>;
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const { app, token } = await searchParams;
  const secret = process.env.QFELLOWS_WEBHOOK_SECRET ?? "";

  const verification = verifySignedInviteToken(token ?? "", secret);

  if (!verification.valid || !verification.data || verification.data.applicationId !== app) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 border border-red-200 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Invalid or Expired Invite Link</h1>
          <p className="text-sm text-slate-600">
            This candidate onboarding link is invalid or has expired. Please check the link from your Q-Fellows application or request a new invite.
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Go to Candidate Sign In
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { email, track } = verification.data;

  // Check if current session matches candidate
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isUserMatching = user && user.email?.toLowerCase() === email.toLowerCase();

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            Q-Fellows Integration Handoff
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to Talent Vetting</h1>
          <p className="text-sm text-slate-600">
            Your application for the <span className="font-semibold text-slate-800 uppercase">{track}</span> engineering track has been received from the Q-Fellows Portal.
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2 text-xs text-slate-600">
          <div className="flex justify-between">
            <span className="text-slate-500">Applicant Email:</span>
            <span className="font-mono font-medium text-slate-800">{email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Track:</span>
            <span className="font-mono font-medium text-slate-800 uppercase">{track}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Stage Status:</span>
            <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              Registration Ready
            </span>
          </div>
        </div>

        {isUserMatching ? (
          <div className="text-center space-y-3">
            <p className="text-xs text-emerald-700 font-medium">
              You are signed in as {user.email}.
            </p>
            <Link
              href="/dashboard"
              className="w-full inline-flex justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Continue to Candidate Dashboard
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <Link
              href={`/login?email=${encodeURIComponent(email)}`}
              className="w-full inline-flex justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Sign In with {email}
            </Link>
            <Link
              href={`/register?email=${encodeURIComponent(email)}`}
              className="w-full inline-flex justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Set Password / Activate Account
            </Link>
          </div>
        )}

        <div className="border-t border-slate-100 pt-4 text-center">
          <p className="text-[11px] text-slate-400">
            Next steps: Government ID upload &rarr; Stage 1 Foundation Screen &rarr; Timed Exam &rarr; Practical Project &rarr; Live Defence.
          </p>
        </div>
      </div>
    </main>
  );
}

