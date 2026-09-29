import { AuthScreen } from "@/components/auth/auth-screen";
import { auth } from "@/lib/auth";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const params = await searchParams;
  const flow = await auth.startRecovery();
  return <AuthScreen mode="forgot" error={params.error} notice={params.notice} configured={flow.available} recoveryMethod={flow.method} />;
}
