import { redirect } from "next/navigation";
import { getAuthAllowLocked } from "@/lib/auth";
import { homePathFor } from "@/lib/home";

/** Entry point for the installed app (manifest start_url). Sends each signed-in role straight to its own home page. */
export default async function OpenPage() {
  const ctx = await getAuthAllowLocked();
  if (!ctx) redirect("/login");
  redirect(homePathFor(ctx.user.role));
}
