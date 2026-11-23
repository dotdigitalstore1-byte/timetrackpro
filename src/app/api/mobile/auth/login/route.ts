import { signIn } from "@/lib/sign-in";

/**
 * Employee sign-in for the Flutter mobile app. Returns a bearer token in the body instead of setting a cookie.
 * Employees only: every other role gets the same "mobile app is for employees only" response as before.
 * Send the token as "Authorization: Bearer <token>" on later requests, and store it in secure device storage.
 */
export async function POST(req: Request) {
  return signIn(req, "workspace", "token");
}
