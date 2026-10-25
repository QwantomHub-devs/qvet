import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { verifyHmacSignature, createSignedInviteToken } from "@/lib/qfellows/webhook-signer";

interface ExternalCandidateBody {
  external_application_id: string;
  email: string;
  full_name: string;
  track_slug: string;
  cohort_code?: string;
  metadata?: Record<string, unknown>;
}

const SUPPORTED_TRACKS = new Set(["ai", "iot", "robotics"]);

export async function POST(request: Request) {
  // 1. Verify API Key
  const apiKey = request.headers.get("x-qtalent-api-key");
  const expectedApiKey = process.env.QFELLOWS_API_KEY;

  if (!expectedApiKey || apiKey !== expectedApiKey) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing X-QTalent-Api-Key header" },
      { status: 401 }
    );
  }

  // 2. Verify Timestamp (Replay Attack Defense: max 300s / 5 mins)
  const timestampHeader =
    request.headers.get("x-qtalent-timestamp") || request.headers.get("x-timestamp");

  if (!timestampHeader) {
    return NextResponse.json(
      { error: "Unauthorized: Missing X-QTalent-Timestamp header" },
      { status: 401 }
    );
  }

  const reqTime = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
    return NextResponse.json(
      { error: "Unauthorized: Request timestamp expired or outside 300s window" },
      { status: 401 }
    );
  }

  // 3. Read Raw Body and Verify HMAC-SHA256 Signature (Timing-Safe)
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-qtalent-signature") || request.headers.get("x-signature");
  const secret = process.env.QFELLOWS_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration: QFELLOWS_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const isValidSignature = verifyHmacSignature(rawBody, secret, signature);
  if (!isValidSignature) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid HMAC signature" },
      { status: 401 }
    );
  }

  // 4. Parse & Validate Payload
  let body: ExternalCandidateBody;
  try {
    body = JSON.parse(rawBody) as ExternalCandidateBody;
  } catch {
    return NextResponse.json({ error: "Bad Request: Malformed JSON payload" }, { status: 400 });
  }

  const { external_application_id, email, full_name, track_slug, cohort_code, metadata } = body;

  if (!external_application_id || !email || !full_name || !track_slug) {
    return NextResponse.json(
      { error: "Bad Request: Missing required candidate fields (external_application_id, email, full_name, track_slug)" },
      { status: 400 }
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = full_name.trim();
  const cleanTrack = track_slug.trim().toLowerCase();

  if (!SUPPORTED_TRACKS.has(cleanTrack)) {
    return NextResponse.json(
      { error: `Invalid track_slug '${cleanTrack}'. Active tracks are: ai, iot, robotics.` },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleSupabaseClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // 5. Strict Idempotency Check on external_application_id
  const { data: existingApp, error: fetchErr } = await supabase
    .from("applications")
    .select("id, status, track, user_id")
    .eq("external_application_id", external_application_id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (existingApp) {
    const inviteToken = createSignedInviteToken(
      {
        applicationId: existingApp.id,
        email: cleanEmail,
        track: existingApp.track,
      },
      secret
    );

    return NextResponse.json(
      {
        success: true,
        vetting_application_id: existingApp.id,
        status: existingApp.status,
        invite_url: `${siteUrl}/start?app=${existingApp.id}&token=${inviteToken}`,
        idempotent: true,
      },
      { status: 200 }
    );
  }

  // 6. Resolve or Create User Profile Stub
  let userId: string;

  // Generate new user in auth.users via Admin Auth API (or retrieve if already exists)
  const { data: newUser, error: userCreateErr } = await supabase.auth.admin.createUser({
    email: cleanEmail,
    email_confirm: true,
    user_metadata: {
      full_name: cleanName,
      source: "qfellows_handoff",
    },
  });

  if (newUser?.user) {
    userId = newUser.user.id;
  } else {
    // User already exists, retrieve by email
    const { data: listData } = await supabase.auth.admin.listUsers();
    const match = listData?.users.find((u) => u.email?.toLowerCase() === cleanEmail);
    if (match) {
      userId = match.id;
    } else {
      return NextResponse.json(
        { error: `Could not initialize user account: ${userCreateErr?.message ?? "Unknown error"}` },
        { status: 500 }
      );
    }
  }

  // Ensure profile row exists with candidate metadata
  await supabase.from("profiles").upsert(
    {
      user_id: userId,
      full_name: cleanName,
      country: (metadata?.country as string) ?? null,
      github_url: (metadata?.github_url as string) ?? null,
      role: "candidate",
    },
    { onConflict: "user_id" }
  );

  // 7. Resolve Cohort (Auto-upsert cohort_code if provided)
  let cohortId: string | null = null;
  if (cohort_code) {
    const cleanCohortCode = cohort_code.trim();
    const { data: cohortRow } = await supabase
      .from("cohorts")
      .select("id")
      .eq("code", cleanCohortCode)
      .maybeSingle();

    if (cohortRow) {
      cohortId = cohortRow.id;
    } else {
      const { data: newCohort } = await supabase
        .from("cohorts")
        .insert({
          code: cleanCohortCode,
          name: `Q-Fellows ${cleanCohortCode}`,
          track: cleanTrack,
          active: true,
        })
        .select("id")
        .maybeSingle();

      cohortId = newCohort?.id ?? null;
    }
  }

  // 8. Create Vetting Application
  const mergedMetadata = {
    ...(metadata ?? {}),
    qfellows_intake: true,
    intake_timestamp: new Date().toISOString(),
  };

  const { data: newApp, error: insertAppErr } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      track: cleanTrack,
      cohort_id: cohortId,
      status: "registered",
      external_application_id,
      external_cohort_code: cohort_code?.trim() ?? null,
      track_metadata: mergedMetadata,
      consent_at: new Date().toISOString(),
      consent_version: "v1.0-qfellows",
    })
    .select("id, status")
    .single();

  if (insertAppErr || !newApp) {
    return NextResponse.json(
      { error: `Failed to create application: ${insertAppErr?.message ?? "Unknown error"}` },
      { status: 500 }
    );
  }

  // 9. Generate Signed Invite URL
  const inviteToken = createSignedInviteToken(
    {
      applicationId: newApp.id,
      email: cleanEmail,
      track: cleanTrack,
    },
    secret
  );

  return NextResponse.json(
    {
      success: true,
      vetting_application_id: newApp.id,
      status: newApp.status,
      invite_url: `${siteUrl}/start?app=${newApp.id}&token=${inviteToken}`,
    },
    { status: 201 }
  );
}
