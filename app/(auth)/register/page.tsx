import { AuthScreen } from "@/components/auth/auth-screen";
import { auth } from "@/lib/auth";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const flow = await auth.startRegistration();
  return <AuthScreen mode="register" error={params.error} configured={flow.available} />;
}
