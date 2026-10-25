"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { flushOutboundWebhooks } from "@/lib/qfellows/webhook-dispatcher";
import { resetCircuitBreaker } from "@/lib/qfellows/circuit-breaker";

export interface PlatformTelemetry {
  funnel: {
    total_registered: number;
    id_pending: number;
    id_approved: number;
    s1_passed: number;
    s2_passed: number;
    s3_passed: number;
    s4_passed: number;
    certified: number;
    retake_wait: number;
    rejected: number;
  };
  tracks: {
    ai: number;
    iot: number;
    robotics: number;
  };
  tiers: {
    elite: number;
    certified_pro: number;
    certified: number;
    revoked: number;
  };
  averages: {
    s1_avg: number;
    s2_avg: number;
    s3_avg: number;
    s4_avg: number;
  };
  webhooks: {
    pending: number;
    delivered: number;
    failed: number;
    dead_letter: number;
    total: number;
  };
  grader: {
    queued: number;
    running: number;
    done: number;
    failed: number;
    dead_letter: number;
    total: number;
  };
  circuit_breaker: {
    state: "CLOSED" | "OPEN" | "HALF_OPEN";
    failure_count: number;
    last_failure_at: string | null;
    last_error: string | null;
    cooldown_seconds: number;
    failure_threshold: number;
  };
  generated_at: string;
}

export interface OutboundWebhookLogItem {
  id: string;
  application_id: string;
  event: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  attempts: number;
  next_retry_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  response_status: number | null;
  created_at: string;
}

export interface GradingJobLogItem {
  id: string;
  submission_id: string;
  kind: string;
  mode: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  attempts: number;
  worker_id: string | null;
  error: string | null;
  created_at: string;
}

/**
 * Ensures caller is an authenticated admin.
 */
async function assertAdminCaller() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Authentication required");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    throw new Error("Access denied: Administrator role required");
  }

  return { user, supabase };
}

/**
 * Fetches platform-wide telemetry analytics.
 */
export async function getPlatformTelemetryAction(): Promise<{
  ok: boolean;
  data?: PlatformTelemetry;
  error?: string;
}> {
  try {
    const { supabase } = await assertAdminCaller();
    const { data, error } = await supabase.rpc("get_platform_telemetry");

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data as PlatformTelemetry };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Flushes pending webhooks on demand.
 */
export async function flushWebhooksAction(): Promise<{
  ok: boolean;
  summary?: {
    processed: number;
    delivered: number;
    failed: number;
    deadLetter: number;
    circuitBreakerState?: string;
  };
  error?: string;
}> {
  try {
    await assertAdminCaller();
    const serviceClient = createServiceRoleSupabaseClient();
    const summary = await flushOutboundWebhooks(50, { supabase: serviceClient });

    revalidatePath("/admin");
    return { ok: true, summary };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Re-drives dead-lettered or failed webhooks.
 */
export async function redriveWebhooksAction(webhookIds: string[]): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  try {
    const { supabase } = await assertAdminCaller();
    const { data, error } = await supabase.rpc("admin_redrive_webhooks", {
      p_ids: webhookIds,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/admin");
    return { ok: true, count: Number(data) };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Re-drives dead-lettered or failed grading jobs.
 */
export async function redriveGradingJobsAction(jobIds: string[]): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  try {
    const { supabase } = await assertAdminCaller();
    const { data, error } = await supabase.rpc("admin_redrive_grading_jobs", {
      p_ids: jobIds,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/admin");
    return { ok: true, count: Number(data) };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resets the circuit breaker state to CLOSED.
 */
export async function resetCircuitBreakerAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await assertAdminCaller();
    const serviceClient = createServiceRoleSupabaseClient();
    await resetCircuitBreaker(serviceClient);

    revalidatePath("/admin");
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetches recent outbound webhook entries for table inspection.
 */
export async function fetchRecentWebhooksAction(limit: number = 20): Promise<{
  ok: boolean;
  data?: OutboundWebhookLogItem[];
  error?: string;
}> {
  try {
    const { supabase } = await assertAdminCaller();
    const { data, error } = await supabase
      .from("outbound_webhooks")
      .select("id, application_id, event, status, attempts, next_retry_at, last_attempt_at, last_error, response_status, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: (data as OutboundWebhookLogItem[]) ?? [] };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetches failed / dead-letter grading jobs.
 */
export async function fetchProblemGradingJobsAction(limit: number = 20): Promise<{
  ok: boolean;
  data?: GradingJobLogItem[];
  error?: string;
}> {
  try {
    const { supabase } = await assertAdminCaller();
    const { data, error } = await supabase
      .from("grading_jobs")
      .select("id, submission_id, kind, mode, status, attempts, worker_id, error, created_at")
      .in("status", ["failed", "dead_letter"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: (data as GradingJobLogItem[]) ?? [] };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

