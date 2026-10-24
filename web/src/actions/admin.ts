"use server";

import { revalidatePath } from "next/cache";
import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/database";
import { parseQuestionsCsv } from "@/lib/validation/csv-questions";
import type { ActionResult } from "./auth";

export interface SignedUrlResult extends ActionResult {
  signedUrl?: string;
}

/**
 * Logs the admin ID document read in `audit_log` via `log_admin_id_view` RPC,
 * and then issues a 60-second signed URL from private storage.
 */
export async function getSignedIdDocumentUrlAction(
  idDocumentId: string
): Promise<SignedUrlResult> {
  const supabase = await createServerSupabaseClient();

  // Step 1: Call security-definer RPC as the authenticated user.
  // This verifies the caller is an admin and writes an immutable row to `audit_log`.
  const { data: storagePath, error: logError } = await supabase.rpc("log_admin_id_view", {
    p_id_document_id: idDocumentId,
  });

  if (logError || !storagePath) {
    return {
      ok: false,
      error: logError?.message ?? "Access denied or ID document not found.",
    };
  }

  // Step 2: Generate a short-lived (60 second) signed URL using the server-only service role client
  const serviceClient = createServiceRoleSupabaseClient();
  const { data: signedData, error: signError } = await serviceClient.storage
    .from("id-documents")
    .createSignedUrl(String(storagePath), 60);

  if (signError || !signedData?.signedUrl) {
    return {
      ok: false,
      error: signError?.message ?? "Could not generate signed URL for ID document.",
    };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    signedUrl: signedData.signedUrl,
  };
}

export async function verifyIdDocumentAction(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!applicationId || (decision !== "approved" && decision !== "rejected")) {
    return { ok: false, error: "Invalid verification parameters." };
  }

  if (decision === "rejected" && reason.length < 3) {
    return {
      ok: false,
      error: "Please provide a clear reason when rejecting an ID so the candidate knows what to fix.",
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_verify_id", {
    p_application_id: applicationId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Application ${decision === "approved" ? "approved (Stage 1 unlocked)" : "marked as rejected"}.`,
  };
}

export async function upsertInstitutionAction(formData: FormData): Promise<ActionResult> {
  const idRaw = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const partnerCode = String(formData.get("partnerCode") ?? "").trim();
  const active = formData.get("active") === "true" || formData.get("active") === "on";

  if (!name || !country) {
    return { ok: false, error: "Institution name and country are required." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_upsert_institution", {
    p_id: idRaw || null,
    p_name: name,
    p_country: country,
    p_partner_code: partnerCode || null,
    p_active: active,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: idRaw ? "Institution updated." : "Institution added.",
  };
}

export async function setUserRoleAction(formData: FormData): Promise<ActionResult> {
  const targetUserId = String(formData.get("userId") ?? "").trim();
  const newRole = String(formData.get("role") ?? "").trim() as UserRole;

  if (!targetUserId || !["candidate", "reviewer", "admin"].includes(newRole)) {
    return { ok: false, error: "Invalid user or role specified." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_target_user_id: targetUserId,
    p_new_role: newRole,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    message: `Updated user role to ${newRole}.`,
  };
}

export async function importQuestionsCsvAction(formData: FormData): Promise<ActionResult> {
  const csvText = String(formData.get("csvText") ?? "").trim();
  if (!csvText) {
    return { ok: false, error: "Please paste CSV content or upload a CSV file." };
  }

  const parsed = parseQuestionsCsv(csvText);
  if (!parsed.ok || !parsed.items) {
    return { ok: false, error: parsed.error ?? "Invalid CSV format." };
  }

  const supabase = await createServerSupabaseClient();
  const { data: importedCount, error } = await supabase.rpc("admin_import_questions", {
    p_items: parsed.items,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    message: `Imported ${importedCount} question(s) and locked answer keys into the question bank.`,
  };
}

export async function unlockStage2Action(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  if (!applicationId) {
    return { ok: false, error: "Missing application ID." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_unlock_stage2", {
    p_application_id: applicationId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Application advanced to s2_open (Stage 2 Technical Exam unlocked).",
  };
}

export async function toggleQuestionActiveAction(formData: FormData): Promise<ActionResult> {
  const questionId = String(formData.get("questionId") ?? "").trim();
  const active = formData.get("active") === "true";

  if (!questionId) {
    return { ok: false, error: "Missing question ID." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("questions")
    .update({ active })
    .eq("id", questionId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    message: `Question ${active ? "activated" : "deactivated"}.`,
  };
}

export async function updateRubricCriterionAction(
  formData: FormData
): Promise<ActionResult> {
  const criterionId = String(formData.get("criterionId") ?? "").trim();
  const criterion = String(formData.get("criterion") ?? "").trim();
  const anchor1 = String(formData.get("anchor1") ?? "").trim();
  const anchor2 = String(formData.get("anchor2") ?? "").trim();
  const anchor3 = String(formData.get("anchor3") ?? "").trim();
  const anchor4 = String(formData.get("anchor4") ?? "").trim();

  if (!criterionId || !criterion) {
    return { ok: false, error: "Criterion ID and title are required." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_update_rubric_criterion", {
    p_criterion_id: criterionId,
    p_criterion: criterion,
    p_anchors: {
      "1": anchor1,
      "2": anchor2,
      "3": anchor3,
      "4": anchor4,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/reviewer");
  return {
    ok: true,
    message: "Rubric criterion and score anchors updated.",
  };
}



