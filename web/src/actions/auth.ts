"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createServerSupabaseClient,
} from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (fullName.length < 2) {
    return { ok: false, error: "Please enter your full legal name." };
  }
  if (!email.includes("@")) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters long." };
  }

  const supabase = await createServerSupabaseClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return {
      ok: false,
      error: "An account with this email address already exists.",
    };
  }

  return {
    ok: true,
    message:
      "Account created. Please check your email inbox and click the confirmation link before signing in.",
  };
}

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Please enter both your email and password." };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return {
      ok: false,
      error: error?.message ?? "Could not sign in. Please check your credentials and confirm your email.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, data.session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: data.session.expires_in,
  });
  cookieStore.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  // Determine role to route appropriately
  const authedClient = await createServerSupabaseClient();
  const { data: profile } = await authedClient
    .from("profiles")
    .select("role")
    .eq("user_id", data.user.id)
    .single();

  if (profile?.role === "admin") {
    redirect("/admin");
  }
  if (profile?.role === "reviewer") {
    redirect("/reviewer");
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
  redirect("/login");
}

