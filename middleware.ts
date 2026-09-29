import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicKey } from "@/lib/supabase/config";
import { DEMO_COOKIE_NAME, isDemoAuthEnabled, verifyDemoSessionToken } from "@/lib/demo-auth";

const publicRoutes = ["/login", "/register", "/forgot-password", "/update-password", "/auth/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = getSupabasePublicKey();
  const demoSession = isDemoAuthEnabled()
    ? await verifyDemoSessionToken(request.cookies.get(DEMO_COOKIE_NAME)?.value)
    : null;

  if (!supabaseUrl || !publicKey) {
    if (demoSession && isPublicRoute && pathname !== "/auth/callback") {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = "/dashboard";
      dashboardUrl.search = "";
      return NextResponse.redirect(dashboardUrl);
    }
    if (!isPublicRoute && pathname !== "/" && !demoSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      if (!isDemoAuthEnabled()) loginUrl.searchParams.set("error", "setup");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, publicKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !demoSession && !isPublicRoute && pathname !== "/") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    if (isDemoAuthEnabled()) loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    else loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if ((user || demoSession) && isPublicRoute && pathname !== "/auth/callback") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  // Node runtime: the Edge sandbox rejects the demo session's HMAC check (SubtleCrypto cross-realm buffers).
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};