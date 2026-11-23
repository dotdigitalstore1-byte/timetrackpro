import { signIn } from "@/lib/sign-in";

/** Dedicated Expert Specialist sign-in. Only onboarding_specialist accounts can sign in here. */
export async function POST(req: Request) {
  return signIn(req, "specialist");
}
