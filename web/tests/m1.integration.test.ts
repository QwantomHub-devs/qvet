import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function makeClient(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function signInAs(email: string, password = "Password123!"): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  const client = makeClient(SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
  }
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  });
  return { client: authedClient, userId: data.user.id };
}

describe("M1 Integration Tests: Onboarding, RLS, Private ID Storage, Audit Log & Status Machine", () => {
  let adminClient: SupabaseClient;
  let reviewerClient: SupabaseClient;
  let candidate1Client: SupabaseClient;
  let candidate1Id: string;
  let candidate2Client: SupabaseClient;
  let candidate2Id: string;
  let serviceClient: SupabaseClient;

  beforeAll(async () => {
    if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set to run integration tests."
      );
    }

    serviceClient = makeClient(SUPABASE_SERVICE_ROLE_KEY);

    // Clean any previous test applications / id_documents for candidate1 & candidate2 so tests are idempotent
    await serviceClient
      .from("applications")
      .delete()
      .in("user_id", [
        "00000000-0000-0000-0000-000000000004",
        "00000000-0000-0000-0000-000000000005",
      ]);

    await serviceClient
      .from("profiles")
      .update({ phone: null, github_url: null })
      .in("user_id", [
        "00000000-0000-0000-0000-000000000004",
        "00000000-0000-0000-0000-000000000005",
      ]);

    const adminAuth = await signInAs("admin@vetting.local");
    adminClient = adminAuth.client;

    const reviewerAuth = await signInAs("reviewer1@vetting.local");
    reviewerClient = reviewerAuth.client;

    const c1Auth = await signInAs("candidate1@vetting.local");
    candidate1Client = c1Auth.client;
    candidate1Id = c1Auth.userId;

    const c2Auth = await signInAs("candidate2@vetting.local");
    candidate2Client = c2Auth.client;
    candidate2Id = c2Auth.userId;
  });

  it("allows Candidate 1 to submit Stage 0 onboarding and rejects duplicate phone/GitHub or second track", async () => {
    const { data: app1, error: err1 } = await candidate1Client.rpc("submit_onboarding", {
      p_full_name: "Chinedu Okafor",
      p_country: "Nigeria",
      p_phone: "+234 803 555 0101",
      p_github_url: "https://github.com/chinedu-okafor-ai",
      p_years_experience: 2.5,
      p_self_declared_strengths: "Data cleaning, feature engineering, RAG evaluation",
      p_time_zone: "Africa/Lagos",
      p_weekly_availability_hours: 25,
      p_institution_id: "11111111-1111-1111-1111-111111111101",
      p_other_institution_name: null,
      p_track: "ai",
      p_cohort_id: "22222222-2222-2222-2222-222222222201",
      p_track_metadata: {},
      p_consent: true,
    });

    expect(err1).toBeNull();
    expect(app1.status).toBe("registered");
    expect(app1.current_stage).toBe(0);

    // Candidate 1 cannot submit a second application
    const { error: secondTrackErr } = await candidate1Client.rpc("submit_onboarding", {
      p_full_name: "Chinedu Okafor",
      p_country: "Nigeria",
      p_phone: "+234 803 555 0101",
      p_github_url: "https://github.com/chinedu-okafor-ai",
      p_years_experience: 2.5,
      p_self_declared_strengths: "IoT",
      p_time_zone: "Africa/Lagos",
      p_weekly_availability_hours: 25,
      p_institution_id: "11111111-1111-1111-1111-111111111101",
      p_other_institution_name: null,
      p_track: "iot",
      p_cohort_id: null,
      p_track_metadata: {},
      p_consent: true,
    });
    expect(secondTrackErr).not.toBeNull();
    expect(secondTrackErr?.message).toMatch(/already have an active application/i);

    // Candidate 2 cannot use Candidate 1's phone number
    const { error: dupPhoneErr } = await candidate2Client.rpc("submit_onboarding", {
      p_full_name: "Amina Yusuf",
      p_country: "Nigeria",
      p_phone: "+234-803-555-0101",
      p_github_url: "https://github.com/amina-yusuf-iot",
      p_years_experience: 3,
      p_self_declared_strengths: "ESP32, C++, MQTT",
      p_time_zone: "Africa/Lagos",
      p_weekly_availability_hours: 30,
      p_institution_id: null,
      p_other_institution_name: "Independent Hardware Lab",
      p_track: "iot",
      p_cohort_id: null,
      p_track_metadata: { boards_used: ["ESP32"] },
      p_consent: true,
    });
    expect(dupPhoneErr).not.toBeNull();
    expect(dupPhoneErr?.message).toMatch(/Duplicate account detected.*phone/i);

    // Candidate 2 submits valid onboarding with unique phone & GitHub
    const { data: app2, error: err2 } = await candidate2Client.rpc("submit_onboarding", {
      p_full_name: "Amina Yusuf",
      p_country: "Nigeria",
      p_phone: "+234 809 777 0202",
      p_github_url: "https://github.com/amina-yusuf-iot",
      p_years_experience: 3,
      p_self_declared_strengths: "ESP32, C++, MQTT",
      p_time_zone: "Africa/Lagos",
      p_weekly_availability_hours: 30,
      p_institution_id: null,
      p_other_institution_name: "Independent Hardware Lab",
      p_track: "iot",
      p_cohort_id: null,
      p_track_metadata: { boards_used: ["ESP32"] },
      p_consent: true,
    });
    expect(err2).toBeNull();
    expect(app2.status).toBe("registered");
  });

  it("enforces RLS: a candidate cannot read another candidate's data, and a reviewer cannot see candidate identities", async () => {
    // Candidate 2 queries profiles and applications
    const { data: c2Profiles } = await candidate2Client.from("profiles").select("*");
    expect(c2Profiles?.length).toBe(1);
    expect(c2Profiles?.[0]?.user_id).toBe(candidate2Id);

    const { data: c2Apps } = await candidate2Client.from("applications").select("*");
    expect(c2Apps?.length).toBe(1);
    expect(c2Apps?.[0]?.user_id).toBe(candidate2Id);

    const { data: c2Audit } = await candidate2Client.from("audit_log").select("*");
    expect(c2Audit?.length ?? 0).toBe(0);

    // Reviewer queries profiles and applications
    const { data: revProfiles } = await reviewerClient
      .from("profiles")
      .select("*")
      .eq("role", "candidate");
    expect(revProfiles?.length ?? 0).toBe(0);

    const { data: revApps } = await reviewerClient.from("applications").select("*");
    expect(revApps?.length ?? 0).toBe(0);
  });

  it("prevents a candidate from writing status, score, or role", async () => {
    // Candidate 1 tries to escalate role to admin
    const { error: roleErr } = await candidate1Client
      .from("profiles")
      .update({ role: "admin" })
      .eq("user_id", candidate1Id);
    expect(roleErr).not.toBeNull();

    // Candidate 1 tries to directly update application status or score
    const { data: updatedStatusRows } = await candidate1Client
      .from("applications")
      .update({ status: "approved", score: 98.5 })
      .eq("user_id", candidate1Id)
      .select("*");
    expect(updatedStatusRows?.length ?? 0).toBe(0);

    // Verify application is still registered with null score
    const { data: currentApp } = await candidate1Client
      .from("applications")
      .select("*")
      .eq("user_id", candidate1Id)
      .single();
    expect(currentApp.status).toBe("registered");
    expect(currentApp.score).toBeNull();

    // Candidate 1 tries to call advance_status RPC directly
    const { error: directAdvanceErr } = await candidate1Client.rpc("advance_status", {
      p_application_id: currentApp.id,
      p_new_status: "id_pending",
      p_reason: "Direct client call",
    });
    expect(directAdvanceErr).not.toBeNull();
    expect(directAdvanceErr?.message).toMatch(/cannot call advance_status directly/i);
  });

  it("uploads ID to private storage, logs admin ID reads, rejects illegal transitions, and approves candidate ID", async () => {
    const { data: app1 } = await candidate1Client
      .from("applications")
      .select("*")
      .eq("user_id", candidate1Id)
      .single();

    const storagePath = `${candidate1Id}/${app1.id}/id-card.png`;
    const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    // Candidate 2 cannot upload into Candidate 1's storage folder
    const { error: crossUploadErr } = await candidate2Client.storage
      .from("id-documents")
      .upload(storagePath, fakePngBytes, { contentType: "image/png" });
    expect(crossUploadErr).not.toBeNull();

    // Candidate 1 uploads their ID file into private storage
    const { error: uploadErr } = await candidate1Client.storage
      .from("id-documents")
      .upload(storagePath, fakePngBytes, { contentType: "image/png", upsert: true });
    expect(uploadErr).toBeNull();

    // Candidate 1 records ID upload -> status transitions to id_pending
    const { data: idDoc, error: recordErr } = await candidate1Client.rpc("record_id_upload", {
      p_application_id: app1.id,
      p_storage_path: storagePath,
      p_file_size_bytes: fakePngBytes.byteLength,
      p_mime_type: "image/png",
      p_document_number: "NIN-9988776655",
      p_name_on_id: "Chinedu Okafor",
    });
    expect(recordErr).toBeNull();
    expect(idDoc.application_id).toBe(app1.id);

    const { data: appAfterUpload } = await candidate1Client
      .from("applications")
      .select("*")
      .eq("id", app1.id)
      .single();
    expect(appAfterUpload.status).toBe("id_pending");

    // Illegal transitions are rejected even when called by Admin
    const { error: illegalJump1 } = await adminClient.rpc("advance_status", {
      p_application_id: app1.id,
      p_new_status: "s1_open",
      p_reason: "Skip approval",
    });
    expect(illegalJump1).not.toBeNull();
    expect(illegalJump1?.message).toMatch(/Illegal status transition/i);

    const { error: illegalJump2 } = await adminClient.rpc("advance_status", {
      p_application_id: app1.id,
      p_new_status: "certified",
      p_reason: "Skip all stages",
    });
    expect(illegalJump2).not.toBeNull();
    expect(illegalJump2?.message).toMatch(/Illegal status transition/i);

    // Candidate cannot call log_admin_id_view
    const { error: nonAdminViewErr } = await candidate1Client.rpc("log_admin_id_view", {
      p_id_document_id: idDoc.id,
    });
    expect(nonAdminViewErr).not.toBeNull();

    // Admin calls log_admin_id_view and generates a short-lived signed URL
    const { data: loggedPath, error: adminViewErr } = await adminClient.rpc("log_admin_id_view", {
      p_id_document_id: idDoc.id,
    });
    expect(adminViewErr).toBeNull();
    expect(loggedPath).toBe(storagePath);

    const { data: signedUrlData, error: signErr } = await serviceClient.storage
      .from("id-documents")
      .createSignedUrl(String(loggedPath), 60);
    expect(signErr).toBeNull();
    expect(signedUrlData?.signedUrl).toContain("/storage/v1/object/sign/id-documents/");

    // Verify audit_log recorded the admin read of the ID document
    const { data: viewLogs } = await adminClient
      .from("audit_log")
      .select("*")
      .eq("action", "id_document_viewed")
      .eq("entity_id", idDoc.id);
    expect(viewLogs?.length).toBeGreaterThanOrEqual(1);

    // Admin approves the candidate's ID -> status becomes `approved` and stage becomes 1
    const { data: approvedApp, error: approveErr } = await adminClient.rpc("admin_verify_id", {
      p_application_id: app1.id,
      p_decision: "approved",
      p_reason: "Government ID verified clearly",
    });
    expect(approveErr).toBeNull();
    expect(approvedApp.status).toBe("approved");
    expect(approvedApp.current_stage).toBe(1);
  });
});
