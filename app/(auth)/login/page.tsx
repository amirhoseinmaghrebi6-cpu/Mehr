import { AuthScreen } from "@/components/auth/auth-screen";
import { auth } from "@/lib/auth";

type Params = { error?: string; notice?: string; email?: string; next?: string; flow?: string; phone?: string; mode?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const flow = await auth.startLogin();
  return (
    <AuthScreen
      mode="login"
      error={params.error}
      notice={params.notice}
      email={params.email}
      next={params.next}
      configured={flow.available}
      demoCredentials={flow.demoCredentials}
      loginMethods={flow.methods}
      flowId={params.flow}
      phone={params.phone}
      passwordMode={params.mode === "password"}
    />
  );
}
