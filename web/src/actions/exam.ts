"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ServedQuestion, StageResult } from "@/lib/types/database";
import type { ActionResult } from "./auth";

export interface StartExamResult extends ActionResult {
  attemptId?: string;
  status?: string;
  remainingSeconds?: number;
  currentIndex?: number;
  totalQuestions?: number;
  stageResult?: StageResult;
}

export interface GetQuestionResult extends ActionResult {
  question?: ServedQuestion;
}

export interface SubmitAnswerResult extends ActionResult {
  finished?: boolean;
  currentIndex?: number;
  totalQuestions?: number;
  remainingSeconds?: number;
  stageResult?: StageResult;
}

export async function startOrResumeExamAction(applicationId: string): Promise<StartExamResult> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("start_exam", {
    p_application_id: applicationId,
  });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not start or resume the exam.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/exam");

  return {
    ok: true,
    attemptId: String(data.attempt_id),
    status: String(data.status),
    remainingSeconds: Number(data.remaining_seconds ?? 0),
    currentIndex: Number(data.current_index ?? 0),
    totalQuestions: Number(data.total_questions ?? 40),
    stageResult: (data.stage_result as StageResult | undefined) ?? undefined,
  };
}

export async function getCurrentQuestionAction(attemptId: string): Promise<GetQuestionResult> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_question", {
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not load the current question.",
    };
  }

  return {
    ok: true,
    question: data as ServedQuestion,
  };
}

export async function submitExamAnswerAction(
  attemptId: string,
  questionId: string,
  answer: string
): Promise<SubmitAnswerResult> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("submit_answer", {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_answer: answer,
  });

  if (error || !data) {
    revalidatePath("/dashboard");
    revalidatePath("/exam");
    return {
      ok: false,
      error: error?.message ?? "Could not submit your answer.",
    };
  }

  if (data.finished) {
    revalidatePath("/dashboard");
    revalidatePath("/exam");
  }

  return {
    ok: true,
    finished: Boolean(data.finished),
    currentIndex: Number(data.current_index ?? 0),
    totalQuestions: Number(data.total_questions ?? 40),
    remainingSeconds: Number(data.remaining_seconds ?? 0),
    stageResult: (data.stage_result as StageResult | undefined) ?? undefined,
  };
}

export async function finishExamAttemptAction(
  attemptId: string
): Promise<ActionResult & { stageResult?: StageResult }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("finish_exam", {
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not finalize the exam attempt.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/exam");

  return {
    ok: true,
    stageResult: data as StageResult,
  };
}

export async function logIntegrityEventAction(
  attemptId: string,
  type: "tab_hidden" | "fullscreen_exit",
  meta: Record<string, unknown> = {}
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("log_integrity_event", {
    p_attempt_id: attemptId,
    p_type: type,
    p_meta: meta,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

