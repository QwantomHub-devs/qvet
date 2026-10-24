"use server";

import { revalidatePath } from "next/cache";
import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/lib/supabase/server";
import type { ReviewerQueueItem } from "@/lib/types/database";

export async function getReviewerQueueAction(): Promise<{
  ok: boolean;
  error?: string;
  items?: ReviewerQueueItem[];
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_reviewer_queue");

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    items: (data as ReviewerQueueItem[]) ?? [],
  };
}

export async function getReviewerVideoSignedUrlAction(
  assignmentId: string
): Promise<{
  ok: boolean;
  error?: string;
  signedUrl?: string;
}> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Please sign in as a reviewer." };
  }

  // Verify the caller owns this review assignment (or is admin) via RLS
  const { data: assignment, error: assignErr } = await supabase
    .from("review_assignments")
    .select("id, response_id, reviewer_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (assignErr || !assignment || !assignment.response_id) {
    return {
      ok: false,
      error: assignErr?.message ?? "Review assignment not found or access denied.",
    };
  }

  const { data: resp, error: respErr } = await supabase
    .from("responses")
    .select("id, storage_path")
    .eq("id", assignment.response_id)
    .maybeSingle();

  if (respErr || !resp?.storage_path) {
    return {
      ok: false,
      error: respErr?.message ?? "No video file recorded for this response.",
    };
  }

  const serviceClient = createServiceRoleSupabaseClient();
  const { data: signed, error: signErr } = await serviceClient.storage
    .from("stage1-videos")
    .createSignedUrl(resp.storage_path, 300); // 5-minute signed playback link

  if (signErr || !signed?.signedUrl) {
    return {
      ok: false,
      error: signErr?.message ?? "Could not generate signed video playback URL.",
    };
  }

  return {
    ok: true,
    signedUrl: signed.signedUrl,
  };
}

export async function submitReviewAction(
  assignmentId: string,
  scores: Array<{ criterion_id: string; score: number; comment?: string }>
): Promise<{
  ok: boolean;
  error?: string;
  avgScore?: number;
  thirdReviewTriggered?: boolean;
  finalRubricAvg?: number | null;
  finalPercent?: number | null;
}> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("submit_review", {
    p_assignment_id: assignmentId,
    p_scores: scores,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as {
    avg_score: number;
    third_review_triggered: boolean;
    final_rubric_avg: number | null;
    final_percent: number | null;
  };

  revalidatePath("/reviewer");
  revalidatePath("/dashboard");
  revalidatePath("/admin");

  return {
    ok: true,
    avgScore: Number(payload.avg_score),
    thirdReviewTriggered: Boolean(payload.third_review_triggered),
    finalRubricAvg:
      payload.final_rubric_avg !== null ? Number(payload.final_rubric_avg) : null,
    finalPercent:
      payload.final_percent !== null ? Number(payload.final_percent) : null,
  };
}
