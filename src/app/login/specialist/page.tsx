import { redirect } from "next/navigation";
import { isNativeAppRequest } from "@/lib/app-platform";
import SpecialistLogin from "@/components/SpecialistLogin";

/** Expert Specialist sign-in is website-only. It is not offered in the mobile app. */
export default async function SpecialistLoginPage() {
  if (await isNativeAppRequest()) redirect("/login");
  return <SpecialistLogin />;
}
