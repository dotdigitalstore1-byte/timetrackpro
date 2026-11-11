import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyBranding } from "@/db/schema";

/** Company details printed on salary slips. Maintained under Settings → Company profile. */
export interface CompanyProfile {
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoDataUrl: string | null;
}

/** Loads the company profile and logo. The logo is read here, not in getAuth, so ordinary requests stay light. */
export async function loadCompanyProfile(companyId: string): Promise<CompanyProfile> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const [b] = await db.select().from(companyBranding).where(eq(companyBranding.companyId, companyId)).limit(1);
  return {
    name: c?.name ?? "",
    legalName: c?.legalName ?? "",
    address: c?.address ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    website: c?.website ?? "",
    taxId: c?.taxId ?? "",
    logoDataUrl: b?.logoDataUrl ?? null,
  };
}
