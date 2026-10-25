"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Stage4Booking } from "@/lib/types/database";

export async function getStage4BookingAction(applicationId: string): Promise<{
  ok: boolean;
  error?: string;
  booking?: Stage4Booking | null;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("stage4_bookings")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, booking: (data as Stage4Booking) ?? null };
}

export async function bookStage4DefenceAction(
  applicationId: string,
  scheduledAt: string,
  meetingUrl: string,
  notes?: string
): Promise<{
  ok: boolean;
  error?: string;
  booking?: Stage4Booking;
}> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("book_stage4_defence", {
    p_application_id: applicationId,
    p_scheduled_at: scheduledAt,
    p_meeting_url: meetingUrl,
    p_reviewer_id: null,
    p_notes: notes ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/defence");
  revalidatePath("/dashboard");
  revalidatePath("/reviewer");

  return { ok: true, booking: data as Stage4Booking };
}

export async function submitStage4ReviewAction(
  bookingId: string,
  scores: Array<{ criterion_id: string; score: number; comment?: string }>,
  comment?: string
): Promise<{
  ok: boolean;
  error?: string;
  result?: {
    booking_id: string;
    application_id: string;
    average_score: number;
    percent: number;
    passed: boolean;
    understanding_own_work: number;
  };
}> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("submit_stage4_review", {
    p_booking_id: bookingId,
    p_scores: scores,
    p_comment: comment ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/reviewer");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return {
    ok: true,
    result: data as {
      booking_id: string;
      application_id: string;
      average_score: number;
      percent: number;
      passed: boolean;
      understanding_own_work: number;
    },
  };
}
