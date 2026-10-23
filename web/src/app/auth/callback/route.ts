import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createServerSupabaseClient,
} from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");

  const supabase = await createServerSupabaseClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
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
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "email" | "recovery",
    });
    if (!error && data.session) {
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
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

