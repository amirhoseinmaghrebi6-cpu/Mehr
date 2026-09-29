"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect("/login?notice=signed-out");
}
