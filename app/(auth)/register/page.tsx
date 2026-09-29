import { AuthScreen } from "@/components/auth/auth-screen";
import { auth } from "@/lib/auth";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; flow?: string; phone?: string }> }) {
  const params = await searchParams;
  const flow = await auth.startRegistration();
  return (
    <AuthScreen
      mode="register"
      error={params.error}
      configured={flow.available}
      registrationMethod={flow.method}
      flowId={params.flow}
      phone={params.phone}
    />
  );
}
