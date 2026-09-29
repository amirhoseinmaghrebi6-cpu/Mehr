import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

function safePath(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = safePath(request.nextUrl.searchParams.get("next"));

  if (!code) return NextResponse.redirect(new URL("/login?error=verification", request.url));

  const result = await auth.completeEmailLink(code);
  if (!result.ok) return NextResponse.redirect(new URL("/login?error=verification", request.url));

  return NextResponse.redirect(new URL(destination, request.url));
}
