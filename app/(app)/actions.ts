"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { DEMO_COOKIE_NAME } from "@/lib/demo-auth";

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE_NAME);
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login?notice=signed-out");
}
