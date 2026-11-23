import { redirect } from "next/navigation";
import { getAuthAllowLocked } from "@/lib/auth";
import { entryPathFor } from "@/lib/home";

/** Entry point for the installed app (manifest start_url) and the native apps. Sends each role to its own home page. */
export default async function OpenPage() {
  const ctx = await getAuthAllowLocked();
  if (!ctx) redirect("/login");
  redirect(entryPathFor({ role: ctx.user.role, locked: ctx.locked }));
}
