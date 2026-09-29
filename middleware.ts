import { NextResponse, type NextRequest } from "next/server";
import { resolveRequestSession } from "@/lib/auth";

const publicRoutes = ["/login", "/register", "/forgot-password", "/update-password", "/auth/callback"];

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
