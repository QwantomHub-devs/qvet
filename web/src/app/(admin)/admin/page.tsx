import { redirect } from "next/navigation";
import { AdminConsoleClient, type AdminApplicationRow } from "@/components/AdminConsoleClient";
import { Navbar } from "@/components/Navbar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  Application,
  AuditLogEntry,
  IdDocument,
  Institution,
  Profile,
  SettingRow,
} from "@/lib/types/database";

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: adminProfileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const adminProfile = adminProfileData as Profile | null;
  if (!adminProfile || adminProfile.role !== "admin") {
    redirect("/dashboard");
  }

  const [
    { data: applicationsData },
    { data: profilesData },
    { data: idDocsData },
    { data: institutionsData },
    { data: auditLogsData },
    { data: settingsData },
  ] = await Promise.all([
    supabase.from("applications").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase
      .from("id_documents")
      .select("*")
      .eq("is_current", true)
      .order("created_at", { ascending: false }),
    supabase.from("institutions").select("*").order("name", { ascending: true }),
    supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(100),
    supabase.from("settings").select("*").order("key", { ascending: true }),
  ]);

  const applications = (applicationsData as Application[] | null) ?? [];
  const profiles = (profilesData as Profile[] | null) ?? [];
  const idDocs = (idDocsData as IdDocument[] | null) ?? [];
  const institutions = (institutionsData as Institution[] | null) ?? [];
  const auditLogs = (auditLogsData as AuditLogEntry[] | null) ?? [];
  const settings = (settingsData as SettingRow[] | null) ?? [];

  const profileByUserId = new Map(profiles.map((p) => [p.user_id, p]));
  const docByAppId = new Map(idDocs.map((d) => [d.application_id, d]));
  const instById = new Map(institutions.map((i) => [i.id, i]));

  const rows: AdminApplicationRow[] = applications.map((app) => {
    const prof = profileByUserId.get(app.user_id) ?? null;
    const inst = prof?.institution_id ? instById.get(prof.institution_id) : undefined;
    const institutionName = inst
      ? `${inst.name} (${inst.country})`
      : prof?.other_institution_name || "Independent / Unspecified";

    return {
      application: app,
      profile: prof,
      currentIdDoc: docByAppId.get(app.id) ?? null,
      institutionName,
    };
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar email={user.email} fullName={adminProfile.full_name} role={adminProfile.role} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Administrator Console (M1)</h1>
          <p className="mt-1 text-sm text-slate-600">
            Verify candidate government IDs, manage partner institutions and user roles, and inspect
            the immutable audit log.
          </p>
        </div>

        <AdminConsoleClient
          rows={rows}
          institutions={institutions}
          profiles={profiles}
          auditLogs={auditLogs}
          settings={settings}
        />
      </main>
    </div>
  );
}
