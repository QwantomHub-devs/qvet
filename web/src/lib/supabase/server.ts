import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./client";

export const ACCESS_TOKEN_COOKIE = "vetting_sb_access_token_#@$&#&#*@";
export const REFRESH_TOKEN_COOKIE = "vetting_sb_refresh_token_#@$&#&#*@";

/**
 * Creates a server-side Supabase client authenticated with the user's session cookie.
 * Enforces all Postgres Row Level Security policies for that user.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") {
    throw new Error("createServerSupabaseClient must only be called on the server.");
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const { url, anonKey } = getSupabasePublicEnv();

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

/**
 * Creates a privileged server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Used ONLY after `log_admin_id_view` has recorded an audit_log entry to sign a 60s storage URL.
 * NEVER import or expose this in browser code.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("SECURITY VIOLATION: Service role client cannot be used in the browser.");
  }

  const { url } = getSupabasePublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable on server.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

