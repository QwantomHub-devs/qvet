"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  Credential,
  OverallResult,
  PublicCredentialVerification,
  EmployerScorecard,
} from "@/lib/types/database";

export async function computeOverallAction(applicationId: string): Promise<{
  ok: boolean;
  error?: string;
  result?: OverallResult;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("compute_overall", {
    p_application_id: applicationId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, result: data as OverallResult };
}

export async function adminIssueCredentialAction(applicationId: string): Promise<{
  ok: boolean;
  error?: string;
  credential?: Credential;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("admin_issue_credential", {
    p_application_id: applicationId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return { ok: true, credential: data as Credential };
}

export async function adminRevokeCredentialAction(
  credentialId: string,
  reason: string
): Promise<{
  ok: boolean;
  error?: string;
  credential?: Credential;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("admin_revoke_credential", {
    p_credential_id: credentialId,
    p_reason: reason,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return { ok: true, credential: data as Credential };
}

export async function getPublicCredentialVerificationAction(
  verifyCode: string
): Promise<PublicCredentialVerification> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_public_credential_verification",
    {
      p_verify_code: verifyCode,
    }
  );

  if (error) {
    return { found: false, error: error.message };
  }

  return data as PublicCredentialVerification;
}

export async function getEmployerScorecardAction(
  verifyCode: string
): Promise<EmployerScorecard> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_employer_scorecard", {
    p_verify_code: verifyCode,
  });

  if (error) {
    return { found: false, error: error.message };
  }

  return data as EmployerScorecard;
}

export async function getCandidateCredentialAction(applicationId: string): Promise<{
  ok: boolean;
  error?: string;
  credential?: Credential | null;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("credentials")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, credential: (data as Credential) ?? null };
}
