import type { SupabaseClient } from "@supabase/supabase-js";
import { computeHmacSignature } from "./webhook-signer.ts";
import {
  getCircuitBreakerStatus,
  recordCircuitSuccess,
  recordCircuitFailure,
  type CircuitState,
} from "./circuit-breaker.ts";

export interface OutboundWebhookRow {
  id: string;
  application_id: string;
  event: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  attempts: number;
  next_retry_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  response_status: number | null;
}

export const BACKOFF_DELAYS_SECONDS = [
  5,        // Attempt 1: 5s
  30,       // Attempt 2: 30s
  120,      // Attempt 3: 2m
  600,      // Attempt 4: 10m
  3600,     // Attempt 5: 1h
];

/**
 * Dispatches a single webhook record to the Q-Fellows Portal.
 */
export async function dispatchSingleWebhook(
  webhook: OutboundWebhookRow,
  options: {
    webhookUrl?: string;
    secret?: string;
    fetchFn?: typeof fetch;
  } = {}
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const url = options.webhookUrl ?? process.env.QFELLOWS_WEBHOOK_URL;
  const secret = options.secret ?? process.env.QFELLOWS_WEBHOOK_SECRET;
  const fetchImpl = options.fetchFn ?? fetch;

  if (!url || !secret) {
    return {
      success: false,
      error: "Missing QFELLOWS_WEBHOOK_URL or QFELLOWS_WEBHOOK_SECRET environment variables.",
    };
  }

  const rawPayload = JSON.stringify(webhook.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeHmacSignature(rawPayload, secret);

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QTalent-Signature": `sha256=${signature}`,
        "X-QTalent-Timestamp": String(timestamp),
        "Idempotency-Key": webhook.idempotency_key,
      },
      body: rawPayload,
    });

    if (res.ok) {
      return { success: true, statusCode: res.status };
    }

    const text = await res.text().catch(() => "");
    return {
      success: false,
      statusCode: res.status,
      error: `HTTP ${res.status}: ${text.slice(0, 500)}`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${errorMsg}` };
  }
}

/**
 * Calculates the next retry timestamp using the defined exponential backoff schedule with jitter.
 */
export function getNextRetryTimestamp(attemptCount: number): {
  isTerminal: boolean;
  nextRetryDate: Date;
} {
  const maxAttempts = BACKOFF_DELAYS_SECONDS.length;
  if (attemptCount >= maxAttempts) {
    return { isTerminal: true, nextRetryDate: new Date() };
  }

  const baseDelaySec = BACKOFF_DELAYS_SECONDS[attemptCount] ?? 3600;
  // Add 10% random jitter to prevent thundering herd
  const jitterSec = Math.floor(Math.random() * (baseDelaySec * 0.1));
  const delayMs = (baseDelaySec + jitterSec) * 1000;

  return {
    isTerminal: false,
    nextRetryDate: new Date(Date.now() + delayMs),
  };
}

/**
 * Flushes pending webhooks from the outbox table.
 */
export async function flushOutboundWebhooks(
  limit: number = 25,
  options: {
    webhookUrl?: string;
    secret?: string;
    fetchFn?: typeof fetch;
    supabase?: SupabaseClient;
  } = {}
): Promise<{
  processed: number;
  delivered: number;
  failed: number;
  deadLetter: number;
  circuitBreakerState?: CircuitState;
  circuitBreakerTripped?: boolean;
}> {
  let supabase = options.supabase;
  if (!supabase) {
    const { createServiceRoleSupabaseClient } = await import("../supabase/server");
    supabase = createServiceRoleSupabaseClient();
  }

  // Circuit Breaker check
  const cbStatus = await getCircuitBreakerStatus(supabase);
  if (!cbStatus.canAttempt) {
    return {
      processed: 0,
      delivered: 0,
      failed: 0,
      deadLetter: 0,
      circuitBreakerState: cbStatus.state,
      circuitBreakerTripped: true,
    };
  }

  // Fetch pending or failed webhooks whose retry timestamp has arrived
  const { data: webhooks, error } = await supabase
    .from("outbound_webhooks")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_retry_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !webhooks || webhooks.length === 0) {
    return {
      processed: 0,
      delivered: 0,
      failed: 0,
      deadLetter: 0,
      circuitBreakerState: cbStatus.state,
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  let deadLetterCount = 0;
  let currentCbState = cbStatus.state;

  for (const item of webhooks as OutboundWebhookRow[]) {
    const dispatchResult = await dispatchSingleWebhook(item, options);
    const nowIso = new Date().toISOString();
    const attempts = item.attempts + 1;

    if (dispatchResult.success) {
      deliveredCount++;
      await supabase
        .from("outbound_webhooks")
        .update({
          status: "delivered",
          attempts,
          last_attempt_at: nowIso,
          response_status: dispatchResult.statusCode ?? 200,
          last_error: null,
          updated_at: nowIso,
        })
        .eq("id", item.id);

      // Record success in circuit breaker
      const newCb = await recordCircuitSuccess(supabase);
      currentCbState = newCb.state;
    } else {
      const statusCode = dispatchResult.statusCode;
      const is4xx = typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;

      // Rule 6.2: Do NOT retry on 4xx client errors (bad request, invalid signature, not found)
      if (is4xx) {
        deadLetterCount++;
        await supabase
          .from("outbound_webhooks")
          .update({
            status: "dead_letter",
            attempts,
            last_attempt_at: nowIso,
            response_status: statusCode,
            last_error: dispatchResult.error,
            updated_at: nowIso,
          })
          .eq("id", item.id);
      } else {
        // 5xx server error or network failure: trip circuit breaker if threshold hit
        const cbConfig = await recordCircuitFailure(dispatchResult.error ?? "Dispatch error", supabase);
        currentCbState = cbConfig.state;

        const { isTerminal, nextRetryDate } = getNextRetryTimestamp(attempts - 1);
        if (isTerminal) {
          failedCount++;
          await supabase
            .from("outbound_webhooks")
            .update({
              status: "failed",
              attempts,
              last_attempt_at: nowIso,
              response_status: statusCode ?? null,
              last_error: dispatchResult.error,
              updated_at: nowIso,
            })
            .eq("id", item.id);
        } else {
          failedCount++;
          await supabase
            .from("outbound_webhooks")
            .update({
              status: "failed",
              attempts,
              next_retry_at: nextRetryDate.toISOString(),
              last_attempt_at: nowIso,
              response_status: statusCode ?? null,
              last_error: dispatchResult.error,
              updated_at: nowIso,
            })
            .eq("id", item.id);
        }

        // If circuit breaker tripped to OPEN, abort remainder of the batch immediately
        if (currentCbState === "OPEN") {
          break;
        }
      }
    }
  }

  return {
    processed: deliveredCount + failedCount + deadLetterCount,
    delivered: deliveredCount,
    failed: failedCount,
    deadLetter: deadLetterCount,
    circuitBreakerState: currentCbState,
  };
}
