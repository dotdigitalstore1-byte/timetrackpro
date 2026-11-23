import { headers } from "next/headers";
import { isNativeAppUserAgent } from "@/lib/app-platform-core";

/** Server components and layouts: is this page request coming from the native Dotinout app? */
export async function isNativeAppRequest(): Promise<boolean> {
  return isNativeAppUserAgent((await headers()).get("user-agent"));
}
