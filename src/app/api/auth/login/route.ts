import { signIn } from "@/lib/sign-in";

/** Company admin, manager and employee sign-in (and the platform owner). Expert Specialists use /api/auth/specialist/login. */
export async function POST(req: Request) {
  return signIn(req, "workspace");
}
