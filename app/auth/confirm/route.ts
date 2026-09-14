import { NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const code = request.nextUrl.searchParams.get("code");

  if (!tokenHash && !code) {
    return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
  }

  const response = NextResponse.redirect(new URL("/preorder", request.url));
  response.headers.set("Cache-Control", "no-store");
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
      },
    },
  );
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "email" });

  if (error) {
    console.error("E-mail-megerősítési hiba:", {
      name: error.name,
      message: error.message,
      status: error.status,
      code: error.code,
    });

    return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
  }

  return response;
}
