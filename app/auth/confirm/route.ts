import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    console.error("E-mail-megerősítési hiba:", {
      name: error.name,
      message: error.message,
      status: error.status,
      code: error.code,
    });

    return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
  }

  return NextResponse.redirect(new URL("/preorder", request.url));
}
