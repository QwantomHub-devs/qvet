import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import type { UserRole } from "@/lib/types/database";

interface NavbarProps {
  email?: string | null;
  fullName?: string | null;
  role?: UserRole | null;
}

export function Navbar({ email, fullName, role }: NavbarProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 focus:outline-2 focus:outline-offset-2 focus:outline-slate-900"
          >
            Talent Vetting Platform
          </Link>
          {role && (
            <nav aria-label="Main navigation" className="flex items-center gap-4 text-sm font-medium">
              {role === "candidate" && (
                <Link href="/dashboard" className="text-slate-700 hover:text-slate-900">
                  Candidate Dashboard
                </Link>
              )}
              {role === "reviewer" && (
                <Link href="/reviewer" className="text-slate-700 hover:text-slate-900">
                  Reviewer Console
                </Link>
              )}
              {role === "admin" && (
                <Link href="/admin" className="text-slate-700 hover:text-slate-900">
                  Admin Console
                </Link>
              )}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {email ? (
            <>
              <span className="text-slate-600">
                {fullName ? `${fullName} (${email})` : email}
              </span>
              {role && (
                <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase text-slate-800">
                  {role}
                </span>
              )}
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
              >
                Create account
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

