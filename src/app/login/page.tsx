import { headers } from "next/headers";
import { isNativeAppRequest } from "@/lib/app-platform";
import { loadRegistrationUrl } from "@/lib/app-downloads";
import WorkspaceLogin from "@/components/WorkspaceLogin";
import EmployeeLogin from "@/components/EmployeeLogin";

/** The mobile app always gets the employee-only sign-in. The website keeps the workspace sign-in. */
export default async function LoginPage() {
  if (await isNativeAppRequest()) {
    const host = (await headers()).get("host");
    return <EmployeeLogin registrationUrl={await loadRegistrationUrl(host)} />;
  }
  return <WorkspaceLogin />;
}
