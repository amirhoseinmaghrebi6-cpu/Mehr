import { AuthScreen } from "@/components/auth/auth-screen";
import { getDemoCredentials, isDemoAuthEnabled } from "@/lib/demo-auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; email?: string; next?: string }> }) {
  const params = await searchParams;
  const demoCredentials = isDemoAuthEnabled() ? getDemoCredentials() : null;
  return <AuthScreen mode="login" error={params.error} notice={params.notice} email={params.email} next={params.next} configured={isSupabaseConfigured() || Boolean(demoCredentials)} demoCredentials={demoCredentials} />;
}
