"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Track, TrackMetadata } from "@/lib/types/database";
import {
  checkUrlReachable,
  validateOnboardingInput,
  type OnboardingInput,
} from "@/lib/validation/onboarding";
import type { ActionResult } from "./auth";

export async function submitOnboardingAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const track = String(formData.get("track") ?? "") as Track;
  const institutionChoice = String(formData.get("institutionId") ?? "").trim();
  const isOtherInstitution = institutionChoice === "other" || institutionChoice === "";
  const institutionId = isOtherInstitution ? null : institutionChoice;
  const otherInstitutionName = isOtherInstitution
    ? String(formData.get("otherInstitutionName") ?? "").trim()
    : null;
  const cohortChoice = String(formData.get("cohortId") ?? "").trim();
  const cohortId = cohortChoice ? cohortChoice : null;

  const trackMetadata: TrackMetadata = {};
  if (track === "iot") {
    trackMetadata.boards_used = formData.getAll("iotBoards").map(String);
    trackMetadata.sensors_used = formData.getAll("iotSensors").map(String);
    trackMetadata.protocols_used = formData.getAll("iotProtocols").map(String);
    trackMetadata.has_hardware_or_lab_access = formData.get("iotHardwareAccess") === "yes";
    const hwUrl = String(formData.get("iotProjectUrl") ?? "").trim();
    if (hwUrl) {
      trackMetadata.past_hardware_project_url = hwUrl;
    }
  } else if (track === "robotics") {
    trackMetadata.tools_used = formData.getAll("roboticsTools").map(String);
    trackMetadata.python_comfort = Number(formData.get("pythonComfort") ?? 3);
    trackMetadata.cpp_comfort = Number(formData.get("cppComfort") ?? 2);
    trackMetadata.has_physical_robot_or_lab_access = formData.get("roboticsLabAccess") === "yes";
    const robotUrl = String(formData.get("roboticsProjectUrl") ?? "").trim();
    if (robotUrl) {
      trackMetadata.robot_project_url = robotUrl;
    }
  }

  const input: OnboardingInput = {
    fullName: String(formData.get("fullName") ?? "").trim(),
    country: String(formData.get("country") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    githubUrl: String(formData.get("githubUrl") ?? "").trim(),
    yearsExperience: Number(formData.get("yearsExperience") ?? 0),
    selfDeclaredStrengths: String(formData.get("selfDeclaredStrengths") ?? "").trim(),
    timeZone: String(formData.get("timeZone") ?? "").trim(),
    weeklyAvailabilityHours: Number(formData.get("weeklyAvailabilityHours") ?? 0),
    institutionId,
    otherInstitutionName,
    track,
    cohortId,
    trackMetadata,
    consent: formData.get("consent") === "on" || formData.get("consent") === "true",
  };

  const validationError = validateOnboardingInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // Stage 0 Automatic Check: Verify GitHub / portfolio link resolves
  if (process.env.SKIP_URL_REACHABILITY_CHECK !== "true") {
    const reachability = await checkUrlReachable(input.githubUrl);
    if (!reachability.ok) {
      return {
        ok: false,
        error: reachability.error ?? "Your GitHub or portfolio link could not be reached.",
      };
    }

    if (typeof trackMetadata.past_hardware_project_url === "string") {
      const hwCheck = await checkUrlReachable(trackMetadata.past_hardware_project_url);
      if (!hwCheck.ok) {
        return {
          ok: false,
          error: `Hardware project link check failed: ${hwCheck.error}`,
        };
      }
    }

    if (typeof trackMetadata.robot_project_url === "string") {
      const robotCheck = await checkUrlReachable(trackMetadata.robot_project_url);
      if (!robotCheck.ok) {
        return {
          ok: false,
          error: `Robotics project link check failed: ${robotCheck.error}`,
        };
      }
    }
  }

  const { error } = await supabase.rpc("submit_onboarding", {
    p_full_name: input.fullName,
    p_country: input.country,
    p_phone: input.phone,
    p_github_url: input.githubUrl,
    p_years_experience: input.yearsExperience,
    p_self_declared_strengths: input.selfDeclaredStrengths,
    p_time_zone: input.timeZone,
    p_weekly_availability_hours: input.weeklyAvailabilityHours,
    p_institution_id: input.institutionId,
    p_other_institution_name: input.otherInstitutionName,
    p_track: input.track,
    p_cohort_id: input.cohortId,
    p_track_metadata: input.trackMetadata,
    p_consent: input.consent,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Application details saved. Please upload your government ID to complete Stage 0.",
  };
}

export async function uploadIdDocumentAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const documentNumber = String(formData.get("documentNumber") ?? "").trim();
  const nameOnId = String(formData.get("nameOnId") ?? "").trim();
  const file = formData.get("idFile");

  if (!applicationId) {
    return { ok: false, error: "Missing application reference." };
  }
  if (!nameOnId) {
    return { ok: false, error: "Please enter the full name printed on your government ID." };
  }
  if (documentNumber.replace(/[^a-zA-Z0-9]/g, "").length < 4) {
    return { ok: false, error: "Please enter your government ID number." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a valid ID image or PDF file to upload." };
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    return {
      ok: false,
      error: "Unsupported file format. Please upload a JPEG, PNG, WebP, or PDF file.",
    };
  }

  if (file.size > 5 * 1024 * 1024) {
    return {
      ok: false,
      error: "File is too large. Maximum allowed size for an ID document is 5 MB.",
    };
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/${applicationId}/${Date.now()}-${safeFileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("id-documents")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { error: rpcError } = await supabase.rpc("record_id_upload", {
    p_application_id: applicationId,
    p_storage_path: storagePath,
    p_file_size_bytes: file.size,
    p_mime_type: file.type,
    p_document_number: documentNumber,
    p_name_on_id: nameOnId,
  });

  if (rpcError) {
    return { ok: false, error: rpcError.message };
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Government ID uploaded. Your application is now pending administrator verification.",
  };
}

