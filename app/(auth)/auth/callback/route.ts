import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (!code || !isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/login?error=verification", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=verification", request.url));

  return NextResponse.redirect(new URL(destination, request.url));
}
