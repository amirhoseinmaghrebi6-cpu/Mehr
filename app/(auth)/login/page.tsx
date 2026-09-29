import { AuthScreen } from "@/components/auth/auth-screen";
import { auth } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; email?: string; next?: string }> }) {
  const params = await searchParams;
  const flow = await auth.startLogin();
  return <AuthScreen mode="login" error={params.error} notice={params.notice} email={params.email} next={params.next} configured={flow.available} demoCredentials={flow.demoCredentials} />;
}
