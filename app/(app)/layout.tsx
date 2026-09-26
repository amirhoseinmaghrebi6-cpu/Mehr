import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { DEMO_COOKIE_NAME, isDemoAuthEnabled, verifyDemoSessionToken } from "@/lib/demo-auth";

export default async function AuthenticatedAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (isDemoAuthEnabled()) {
    const cookieStore = await cookies();
    const demoSession = await verifyDemoSessionToken(cookieStore.get(DEMO_COOKIE_NAME)?.value);
    if (demoSession) {
      return <AppShell userId={demoSession.userId} displayName="M2smart Demo" demoMode>{children}</AppShell>;
    }
  }

  if (!isSupabaseConfigured()) redirect(isDemoAuthEnabled() ? "/login" : "/login?error=setup");

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const displayName = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name
    : user.email?.split("@")[0] ?? "M2smart member";

  return <AppShell userId={user.id} displayName={displayName}>{children}</AppShell>;
}