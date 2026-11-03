import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/features/admin/admin-panel";
import { DemoTwoFactor, TwoFactorGate } from "@/features/admin/two-factor";
import { auth } from "@/lib/auth";

/**
 * The operator's panel. Everyone else gets a 404, so the page does not reveal itself. An operator
 * also needs the second sign-in step, a code from an authenticator app (the API refuses the panel's
 * routes without it): set one up, or type its code. The demo gets the panel too, over sample data,
 * with its second step played in the browser, to show customers.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string }> }) {
  const principal = await auth.getCurrentPrincipal();
  if (!principal) redirect("/login?next=%2Fadmin");
  if (!principal.platformAdmin) notFound();
  if (principal.authMethod === "demo") return <DemoTwoFactor><AdminPanel demoUserId={principal.userId} /></DemoTwoFactor>;
  if (!principal.secondStep) {
    const params = await searchParams;
    return <TwoFactorGate flow={await auth.startTwoFactor()} error={params.error} linked={params.linked === "1"} />;
  }
  return <AdminPanel />;
}
