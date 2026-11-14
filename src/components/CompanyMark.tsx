"use client";

import { useState, type ReactNode } from "react";

/**
 * The company's logo, or `fallback` (the default app icon) when there is none or it fails to load.
 * `version` is the logo's last-update stamp from the server, so a changed logo is fetched again.
 */
export default function CompanyMark({
  version,
  className,
  fallback,
}: {
  version: number | null;
  className: string;
  fallback: ReactNode;
}) {
  const [failedFor, setFailedFor] = useState<number | null>(null);
  if (version === null || failedFor === version) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/company/logo?v=${version}`}
      alt=""
      className={className}
      onError={() => setFailedFor(version)}
    />
  );
}
