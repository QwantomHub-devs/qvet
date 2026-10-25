"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  GradingJob,
  ProjectAttempt,
  ProjectComponentScore,
  Scenario,
  Submission,
  SubmissionPart,
} from "@/lib/types/database";

const MAX_PART_BYTES: Record<SubmissionPart, number> = {
  predictions: 2 * 1024 * 1024, // 2 MB
  retrieval: 1 * 1024 * 1024,   // 1 MB
  notebook: 10 * 1024 * 1024,  // 10 MB
  code: 15 * 1024 * 1024,      // 15 MB
  writeup: 2 * 1024 * 1024,    // 2 MB
};

export interface ProjectStatusResult {
  ok: boolean;
  error?: string;
  attempt?: ProjectAttempt;
  scenario?: Scenario;
  submissions?: Submission[];
  practiceJobs?: GradingJob[];
  finalJobs?: GradingJob[];
  componentScores?: ProjectComponentScore[];
  starterKitUrl?: string;
  remainingSeconds?: number;
  serverTime?: string;
}

export async function getProjectStatusAction(applicationId: string): Promise<ProjectStatusResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in to view your project workspace." };
  }

  const { data, error } = await supabase.rpc("get_project_status", {
    p_application_id: applicationId,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not load project status." };
  }

  const payload = data as {
    attempt: ProjectAttempt | null;
    scenario: Scenario | null;
    submissions: Submission[];
    practice_jobs: GradingJob[];
    final_jobs: GradingJob[];
    component_scores: ProjectComponentScore[];
    remaining_seconds: number;
    server_time: string;
  };

  let starterKitUrl: string | undefined = undefined;
  if (payload.scenario?.starter_kit_path) {
    const { data: signedData } = await supabase.storage
      .from("scenario-kits")
      .createSignedUrl(payload.scenario.starter_kit_path, 3600);
    starterKitUrl = signedData?.signedUrl;
  }

  return {
    ok: true,
    attempt: payload.attempt ?? undefined,
    scenario: payload.scenario ?? undefined,
    submissions: payload.submissions ?? [],
    practiceJobs: payload.practice_jobs ?? [],
    finalJobs: payload.final_jobs ?? [],
    componentScores: payload.component_scores ?? [],
    starterKitUrl,
    remainingSeconds: Number(payload.remaining_seconds ?? 0),
    serverTime: payload.server_time,
  };
}

export async function startProjectAction(
  applicationId: string,
  scenarioId?: string
): Promise<{ ok: boolean; error?: string; attemptId?: string }> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("start_project", {
    p_application_id: applicationId,
    p_scenario_id: scenarioId ?? null,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start project." };
  }

  revalidatePath("/project");
  revalidatePath("/dashboard");

  return { ok: true, attemptId: String(data.id) };
}

export async function pauseProjectAction(
  attemptId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("pause_project", {
    p_attempt_id: attemptId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/project");
  revalidatePath("/dashboard");

  return { ok: true };
}

export async function resumeProjectAction(
  attemptId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("resume_project", {
    p_attempt_id: attemptId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/project");
  revalidatePath("/dashboard");

  return { ok: true };
}

export async function uploadSubmissionFileAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string; submission?: Submission }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Authentication required." };
  }

  const attemptId = String(formData.get("attemptId") ?? "");
  const part = String(formData.get("part") ?? "") as SubmissionPart;
  const file = formData.get("file") as File | null;

  if (!attemptId || !part || !file) {
    return { ok: false, error: "Missing required file or attempt parameters." };
  }

  const maxBytes = MAX_PART_BYTES[part];
  if (!maxBytes) {
    return { ok: false, error: `Invalid project submission part: ${part}` };
  }

  if (file.size > maxBytes) {
    const mbLimit = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `File size exceeds the server limit of ${mbLimit} MB for part '${part}'.`,
    };
  }

  // Upload file to private storage bucket project-submissions
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/${attemptId}/${part}/${Date.now()}_${safeFilename}`;

  const { error: uploadError } = await supabase.storage
    .from("project-submissions")
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });

  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  // Record submission in database
  const { data, error: recordError } = await supabase.rpc("record_submission", {
    p_attempt_id: attemptId,
    p_part: part,
    p_file_path: storagePath,
    p_file_name: file.name,
    p_file_size_bytes: file.size,
    p_mime_type: file.type || "application/octet-stream",
  });

  if (recordError || !data) {
    return { ok: false, error: recordError?.message ?? "Failed to register submission record." };
  }

  revalidatePath("/project");

  return { ok: true, submission: data as Submission };
}

export async function requestPracticeRunAction(
  attemptId: string,
  part: "predictions" | "retrieval"
): Promise<{ ok: boolean; error?: string; job?: GradingJob; runsRemaining?: number }> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("request_practice_run", {
    p_attempt_id: attemptId,
    p_part: part,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to queue practice run." };
  }

  const payload = data as { job: GradingJob; runs_remaining: number };

  revalidatePath("/project");

  return {
    ok: true,
    job: payload.job,
    runsRemaining: Number(payload.runs_remaining ?? 0),
  };
}

export async function finalizeProjectAction(
  attemptId: string,
  aiDisclosure?: string
): Promise<{ ok: boolean; error?: string; attempt?: ProjectAttempt }> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("finalize_project", {
    p_attempt_id: attemptId,
    p_ai_disclosure: aiDisclosure ?? null,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to finalize project submission." };
  }

  revalidatePath("/project");
  revalidatePath("/dashboard");

  return { ok: true, attempt: data as ProjectAttempt };
}

