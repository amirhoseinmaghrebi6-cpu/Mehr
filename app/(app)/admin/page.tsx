import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/features/admin/admin-panel";
import { auth } from "@/lib/auth";

/**
 * The operator's panel. Everyone else gets a 404, so the page does not reveal itself. The demo
 * gets it too, over sample data, to show customers.
 */
export default async function AdminPage() {
  const principal = await auth.getCurrentPrincipal();
  if (!principal) redirect("/login?next=%2Fadmin");
  if (!principal.platformAdmin) notFound();
  return <AdminPanel demoUserId={principal.authMethod === "demo" ? principal.userId : undefined} />;
}
