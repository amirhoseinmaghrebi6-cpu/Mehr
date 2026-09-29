import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";

export default async function AuthenticatedAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await auth.getCurrentPrincipal();
  if (!principal) {
    const { available } = await auth.startLogin();
    redirect(available ? "/login" : "/login?error=setup");
  }

  return (
    <AppShell userId={principal.userId} displayName={principal.displayName} demoMode={principal.authMethod === "demo"}>
      {children}
    </AppShell>
  );
}
