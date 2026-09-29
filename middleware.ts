import { NextResponse, type NextRequest } from "next/server";
import { resolveRequestSession } from "@/lib/auth";

// /update-password is not public: setting a password needs a signed-in user (after an SMS-code
// sign-in with Kratos, or the recovery link session with Supabase).
const publicRoutes = ["/login", "/register", "/forgot-password", "/auth/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const session = await resolveRequestSession(request);

  if (!session.providerConfigured) {
    if (session.signedIn && isPublicRoute && pathname !== "/auth/callback") {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = "/dashboard";
      dashboardUrl.search = "";
      return NextResponse.redirect(dashboardUrl);
    }
    if (!isPublicRoute && pathname !== "/" && !session.signedIn) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      if (!session.demoEnabled) loginUrl.searchParams.set("error", "setup");
      return NextResponse.redirect(loginUrl);
    }
    return session.response;
  }

  if (!session.signedIn && !isPublicRoute && pathname !== "/") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (session.signedIn && isPublicRoute && pathname !== "/auth/callback") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return session.response;
}

export const config = {
  // Node runtime: the Edge sandbox rejects the demo session's HMAC check (SubtleCrypto cross-realm buffers).
  runtime: "nodejs",
  // /api/* is proxied to the M2smart API, which authenticates every request itself (401 JSON,
  // never a login redirect). /images/* are public static files (public/images).
  matcher: ["/((?!api/|images/|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
