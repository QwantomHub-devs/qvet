import type { SupabaseClient } from "@supabase/supabase-js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  state: CircuitState;
  failure_count: number;
  last_failure_at: string | null;
  last_error: string | null;
  cooldown_seconds: number;
  failure_threshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  state: "CLOSED",
  failure_count: 0,
  last_failure_at: null,
  last_error: null,
  cooldown_seconds: 300, // 5 minutes
  failure_threshold: 5,   // 5 consecutive failures
};

/**
 * Reads the current circuit breaker state from settings and evaluates
 * whether an outbound webhook request can proceed.
 */
export async function getCircuitBreakerStatus(
  supabaseClient?: SupabaseClient
): Promise<{
  canAttempt: boolean;
  state: CircuitState;
  config: CircuitBreakerConfig;
}> {
  let supabase = supabaseClient;
  if (!supabase) {
    const { createServiceRoleSupabaseClient } = await import("../supabase/server");
    supabase = createServiceRoleSupabaseClient();
  }

  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "circuit_breaker_qfellows")
    .maybeSingle();

  const config: CircuitBreakerConfig = {
    ...DEFAULT_CONFIG,
    ...((data?.value as Partial<CircuitBreakerConfig>) ?? {}),
  };

  const now = Date.now();
  const lastFailureTime = config.last_failure_at
    ? new Date(config.last_failure_at).getTime()
    : 0;
  const cooldownMs = config.cooldown_seconds * 1000;

  // If OPEN and cooldown has elapsed, move to HALF_OPEN probe state
  if (config.state === "OPEN") {
    if (now - lastFailureTime >= cooldownMs) {
      config.state = "HALF_OPEN";
      // Update in settings
      await supabase
        .from("settings")
        .update({ value: config, updated_at: new Date().toISOString() })
        .eq("key", "circuit_breaker_qfellows");

      return { canAttempt: true, state: "HALF_OPEN", config };
    }

    // Still in cooldown period
    return { canAttempt: false, state: "OPEN", config };
  }

  // CLOSED or already HALF_OPEN
  return { canAttempt: true, state: config.state, config };
}

/**
 * Records a successful outbound dispatch, closing the circuit and clearing failures.
 */
export async function recordCircuitSuccess(
  supabaseClient?: SupabaseClient
): Promise<CircuitBreakerConfig> {
  let supabase = supabaseClient;
  if (!supabase) {
    const { createServiceRoleSupabaseClient } = await import("../supabase/server");
    supabase = createServiceRoleSupabaseClient();
  }

  const newConfig: CircuitBreakerConfig = {
    ...DEFAULT_CONFIG,
    state: "CLOSED",
    failure_count: 0,
    last_failure_at: null,
    last_error: null,
  };

  await supabase
    .from("settings")
    .update({ value: newConfig, updated_at: new Date().toISOString() })
    .eq("key", "circuit_breaker_qfellows");

  return newConfig;
}

/**
 * Records an outbound dispatch failure (5xx server error, timeout, network dropped).
 * Trips circuit to OPEN if threshold reached or if a HALF_OPEN canary probe failed.
 */
export async function recordCircuitFailure(
  errorMsg: string,
  supabaseClient?: SupabaseClient
): Promise<CircuitBreakerConfig> {
  let supabase = supabaseClient;
  if (!supabase) {
    const { createServiceRoleSupabaseClient } = await import("../supabase/server");
    supabase = createServiceRoleSupabaseClient();
  }

  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "circuit_breaker_qfellows")
    .maybeSingle();

  const current: CircuitBreakerConfig = {
    ...DEFAULT_CONFIG,
    ...((data?.value as Partial<CircuitBreakerConfig>) ?? {}),
  };

  const newFailCount = current.failure_count + 1;
  const shouldTrip =
    current.state === "HALF_OPEN" || newFailCount >= current.failure_threshold;

  const updatedConfig: CircuitBreakerConfig = {
    ...current,
    state: shouldTrip ? "OPEN" : current.state,
    failure_count: newFailCount,
    last_failure_at: new Date().toISOString(),
    last_error: errorMsg,
  };

  await supabase
    .from("settings")
    .update({ value: updatedConfig, updated_at: new Date().toISOString() })
    .eq("key", "circuit_breaker_qfellows");

  return updatedConfig;
}

/**
 * Manually resets the circuit breaker back to CLOSED (used by admin console).
 */
export async function resetCircuitBreaker(
  supabaseClient?: SupabaseClient
): Promise<CircuitBreakerConfig> {
  return recordCircuitSuccess(supabaseClient);
}

