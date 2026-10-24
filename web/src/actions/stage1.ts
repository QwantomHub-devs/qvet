"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Stage1Prompt, Stage1Response, ServedQuestion } from "@/lib/types/database";

const ALLOWED_VIDEO_MIMES = new Set([
  "video/webm",
  "video/mp4",
  "video/quicktime",
]);

const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB cap

export interface Stage1PartSession {
  ok: boolean;
  error?: string;
  response?: Stage1Response;
  prompt?: Stage1Prompt;
  remainingSeconds?: number;
}

export async function startStage1PartAction(
  applicationId: string,
  kind: "text" | "video"
): Promise<Stage1PartSession> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in to continue Stage 1." };
  }

  const { data, error } = await supabase.rpc("start_stage1_part", {
    p_application_id: applicationId,
    p_kind: kind,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as {
    response: Stage1Response;
    prompt: Stage1Prompt;
    remaining_seconds: number;
  };

  revalidatePath("/stage1");
  revalidatePath("/dashboard");

  return {
    ok: true,
    response: payload.response,
    prompt: payload.prompt,
    remainingSeconds: Number(payload.remaining_seconds ?? 0),
  };
}

export async function autosaveStage1TextAction(
  applicationId: string,
  text: string
): Promise<{
  ok: boolean;
  error?: string;
  wordCount?: number;
  lastSavedAt?: string;
  remainingSeconds?: number;
  locked?: boolean;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("save_text_response", {
    p_application_id: applicationId,
    p_text: text,
  });

  if (error) {
    const isLocked =
      error.message.includes("locked") || error.message.includes("deadline has passed");
    return { ok: false, error: error.message, locked: isLocked };
  }

  const payload = data as {
    word_count: number;
    last_saved_at: string;
    remaining_seconds: number;
  };

  return {
    ok: true,
    wordCount: Number(payload.word_count ?? 0),
    lastSavedAt: payload.last_saved_at,
    remainingSeconds: Number(payload.remaining_seconds ?? 0),
  };
}

export async function submitStage1TextAction(
  applicationId: string,
  text: string
): Promise<{
  ok: boolean;
  error?: string;
  response?: Stage1Response;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("submit_text_response", {
    p_application_id: applicationId,
    p_text: text,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as { response: Stage1Response };
  revalidatePath("/stage1");
  revalidatePath("/dashboard");
  revalidatePath("/reviewer");

  return {
    ok: true,
    response: payload.response,
  };
}

export async function submitStage1VideoAction(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
  response?: Stage1Response;
}> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in to upload your video response." };
  }

  const applicationId = String(formData.get("application_id") ?? "").trim();
  const durationSeconds = Number(formData.get("duration_seconds") ?? 120);
  const file = formData.get("video_file");

  if (!applicationId) {
    return { ok: false, error: "Missing application ID." };
  }

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please record or select a video file before submitting." };
  }

  const normalizedMime = file.type.split(";")[0]?.trim() || "video/webm";
  if (!ALLOWED_VIDEO_MIMES.has(normalizedMime)) {
    return {
      ok: false,
      error: `Unsupported video type (${normalizedMime}). Allowed: WebM, MP4, or QuickTime (.mov).`,
    };
  }

  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: "Video exceeds the 25 MB limit. Please record at low resolution or upload a smaller clip.",
    };
  }

  if (durationSeconds > 125) {
    return {
      ok: false,
      error: "Video exceeds the 2-minute (120 seconds) maximum duration.",
    };
  }

  const ext =
    normalizedMime === "video/mp4"
      ? "mp4"
      : normalizedMime === "video/quicktime"
        ? "mov"
        : "webm";

  const storagePath = `${user.id}/${applicationId}/stage1-video-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("stage1-videos")
    .upload(storagePath, file, {
      contentType: normalizedMime,
      upsert: true,
    });

  if (uploadErr) {
    return { ok: false, error: `Video upload failed: ${uploadErr.message}` };
  }

  const { data, error } = await supabase.rpc("submit_video_response", {
    p_application_id: applicationId,
    p_storage_path: storagePath,
    p_file_size_bytes: file.size,
    p_mime_type: normalizedMime,
    p_duration_seconds: Math.min(120, Math.max(1, Math.round(durationSeconds))),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as { response: Stage1Response };
  revalidatePath("/stage1");
  revalidatePath("/dashboard");
  revalidatePath("/reviewer");

  return {
    ok: true,
    response: payload.response,
  };
}

export async function startOrResumeStage1LogicExamAction(applicationId: string): Promise<{
  ok: boolean;
  error?: string;
  attemptId?: string;
  status?: string;
  remainingSeconds?: number;
  currentIndex?: number;
  totalQuestions?: number;
  question?: ServedQuestion | null;
}> {
  const supabase = await createServerSupabaseClient();

  const { data: startData, error: startError } = await supabase.rpc("start_exam", {
    p_application_id: applicationId,
    p_stage: 1,
  });

  if (startError) {
    return { ok: false, error: startError.message };
  }

  const payload = startData as {
    attempt_id: string;
    status: string;
    remaining_seconds: number;
    current_index: number;
    total_questions: number;
  };

  if (payload.status !== "in_progress") {
    revalidatePath("/stage1");
    revalidatePath("/dashboard");
    return {
      ok: true,
      attemptId: payload.attempt_id,
      status: payload.status,
      remainingSeconds: 0,
      currentIndex: payload.current_index,
      totalQuestions: payload.total_questions,
      question: null,
    };
  }

  const { data: qData, error: qError } = await supabase.rpc("get_question", {
    p_attempt_id: payload.attempt_id,
    p_index: payload.current_index,
  });

  if (qError) {
    return { ok: false, error: qError.message };
  }

  return {
    ok: true,
    attemptId: payload.attempt_id,
    status: payload.status,
    remainingSeconds: Number((qData as ServedQuestion).remaining_seconds ?? payload.remaining_seconds),
    currentIndex: Number((qData as ServedQuestion).question_index ?? payload.current_index),
    totalQuestions: Number((qData as ServedQuestion).total_questions ?? payload.total_questions),
    question: qData as ServedQuestion,
  };
}

