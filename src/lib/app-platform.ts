import { cookies, headers } from "next/headers";
import { isNativeAppUserAgent, NATIVE_APP_COOKIE } from "@/lib/app-platform-core";

/** Server components and layouts: is this request from the native Dotinout app (user-agent or remembered cookie)? */
export async function isNativeAppRequest(): Promise<boolean> {
  const h = await headers();
  if (isNativeAppUserAgent(h.get("user-agent"))) return true;
  const c = await cookies();
  return c.get(NATIVE_APP_COOKIE)?.value === "1";
}
