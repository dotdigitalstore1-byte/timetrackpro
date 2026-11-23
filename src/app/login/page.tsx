import { isNativeAppRequest } from "@/lib/app-platform";
import { loadAppLinks } from "@/lib/app-downloads";
import WorkspaceLogin from "@/components/WorkspaceLogin";
import EmployeeLogin from "@/components/EmployeeLogin";

/** The mobile app gets the employee-only sign-in. The website keeps the workspace sign-in. */
export default async function LoginPage() {
  if (await isNativeAppRequest()) {
    const links = await loadAppLinks();
    return <EmployeeLogin registrationUrl={links.businessRegistrationUrl} />;
  }
  return <WorkspaceLogin />;
}
