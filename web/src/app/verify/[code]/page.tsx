import Link from "next/link";
import { getPublicCredentialVerificationAction } from "@/actions/credentials";
import { TRACK_LABELS } from "@/lib/types/database";

interface VerifyPageProps {
  params: Promise<{ code: string }>;
}

export default async function PublicVerifyPage({ params }: VerifyPageProps) {
  const { code } = await params;
  const decodedCode = decodeURIComponent(code).trim().toUpperCase();

  const result = await getPublicCredentialVerificationAction(decodedCode);

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header Branding */}
        <div className="text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800"
          >
            <span>Talent Vetting Platform</span>
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Credential Verification
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Public verification record for vetted engineering talent across African partner institutions.
          </p>
        </div>

        {/* Verification Status Card */}
        {!result.found ? (
          <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900">Credential Not Found</h2>
            <p className="text-sm text-slate-600">
              Verification code <span className="font-mono font-bold text-slate-800">{decodedCode}</span> does not match any credential in our records.
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Return to Home
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Top Status Header */}
            <div
              className={`p-6 text-center ${
                result.status === "valid"
                  ? "bg-emerald-600 text-white"
                  : result.status === "revoked"
                  ? "bg-red-600 text-white"
                  : "bg-amber-600 text-white"
              }`}
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                {result.status === "valid" && (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {result.status === "valid"
                  ? "Officially Verified & Valid"
                  : result.status === "revoked"
                  ? "Credential Revoked"
                  : "Credential Expired"}
              </div>

              <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight">
                {result.full_name}
              </h2>

              <p className="mt-1 text-sm text-white/90 font-medium">
                {result.track ? TRACK_LABELS[result.track] : "Engineering"} Track · Tier:{" "}
                <span className="font-bold uppercase tracking-wide">
                  {result.tier === "elite"
                    ? "Elite Certified"
                    : result.tier === "certified_pro"
                    ? "Certified Pro"
                    : "Certified"}
                </span>
              </p>
            </div>

            {/* Details Grid */}
            <div className="p-6 sm:p-8 space-y-6">
              {result.status === "revoked" && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-xs text-red-900">
                  <p className="font-bold">Notice to Employers:</p>
                  <p className="mt-0.5">
                    This credential was revoked by platform administrators and is no longer recognized as an active certification.
                  </p>
                </div>
              )}

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Candidate Name
                  </dt>
                  <dd className="mt-1 font-bold text-slate-900">{result.full_name}</dd>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Certification Tier
                  </dt>
                  <dd className="mt-1 font-bold text-slate-900 capitalize">
                    {result.tier?.replace("_", " ")}
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Track
                  </dt>
                  <dd className="mt-1 font-bold text-slate-900">
                    {result.track ? TRACK_LABELS[result.track] : result.track}
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Verification Code
                  </dt>
                  <dd className="mt-1 font-mono font-bold text-slate-900">
                    {result.verify_code}
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Date Issued
                  </dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {result.issued_at
                      ? new Date(result.issued_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—"}
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Expiry Date (24 Months)
                  </dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {result.expires_at
                      ? new Date(result.expires_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—"}
                  </dd>
                </div>
              </dl>

              {/* Link to Employer Scorecard */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200">
                <span className="text-xs text-slate-500">
                  Are you an hiring partner or employer evaluating this candidate?
                </span>

                <Link
                  href={`/scorecard/${result.verify_code}`}
                  className="rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition"
                >
                  View Employer Scorecard →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Security & Verification Guarantee */}
        <div className="text-center text-xs text-slate-500 space-y-1">
          <p>Verified through cryptographically signed server records.</p>
          <p>
            Candidate personal documents, IDs, and raw question banks are protected under strict platform security policies.
          </p>
        </div>
      </div>
    </main>
  );
}
