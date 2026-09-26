import { AuthScreen } from "@/components/auth/auth-screen";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const params = await searchParams;
  return <AuthScreen mode="forgot" error={params.error} notice={params.notice} configured={isSupabaseConfigured()} />;
}
