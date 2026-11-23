"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Spinner } from "@/components/ui";

interface FileInfo {
  platform: "android" | "ios";
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface AppLinksData {
  playStoreUrl: string | null;
  appStoreUrl: string | null;
  businessRegistrationUrl: string;
  files: { android: FileInfo | null; ios: FileInfo | null };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Super Admin: the Play Store and App Store links, and the Android and iOS direct-download files. */
export default function AppLinksPage() {
  const [data, setData] = useState<AppLinksData | null>(null);
  const [playUrl, setPlayUrl] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api<AppLinksData>("/api/superadmin/app-links");
      setData(res);
      setPlayUrl(res.playStoreUrl ?? "");
      setAppUrl(res.appStoreUrl ?? "");
      setRegistrationUrl(res.businessRegistrationUrl ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load app links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLinks = async () => {
    setError("");
    setNotice("");
    setBusy("links");
    try {
      const res = await api<AppLinksData & { ok: boolean }>("/api/superadmin/app-links", {
        method: "PUT",
        body: JSON.stringify({ playStoreUrl: playUrl, appStoreUrl: appUrl, businessRegistrationUrl: registrationUrl }),
      });
      setData(res);
      setPlayUrl(res.playStoreUrl ?? "");
      setAppUrl(res.appStoreUrl ?? "");
      setRegistrationUrl(res.businessRegistrationUrl ?? "");
      setNotice("Links saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the links");
    } finally {
      setBusy(null);
    }
  };

  // Uploads use FormData, so they do not go through the JSON helper.
  const uploadFile = async (platform: "android" | "ios", file: File | undefined) => {
    if (!file) return;
    setError("");
    setNotice("");
    setBusy(`upload-${platform}`);
    try {
      const form = new FormData();
      form.append("platform", platform);
      form.append("file", file);
      const res = await fetch("/api/superadmin/app-links/file", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "The file could not be uploaded.");
      setNotice(`${platform === "android" ? "Android" : "iOS"} file uploaded.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be uploaded.");
    } finally {
      setBusy(null);
    }
  };

  const removeFile = async (platform: "android" | "ios") => {
    if (!window.confirm(`Remove the ${platform === "android" ? "Android" : "iOS"} direct download? Its button will be hidden.`)) return;
    setBusy(`remove-${platform}`);
    try {
      await api(`/api/superadmin/app-links/file?platform=${platform}`, { method: "DELETE" });
      setNotice("File removed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the file");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Links" subtitle="These appear on the page employees see after they sign in on the web." />
      {error && <ErrorBanner message={error} />}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-bold text-slate-900">Store links</h2>
          <p className="text-sm text-slate-500">
            Leave a link empty to show its button as &quot;Link not added yet&quot;. Links must go to the store&apos;s own domain.
          </p>
        </div>
        <Input
          label="Google Play Store link"
          value={playUrl}
          onChange={setPlayUrl}
          placeholder="https://play.google.com/store/apps/details?id=com.dotinout.app"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Input
          label="Apple App Store link"
          value={appUrl}
          onChange={setAppUrl}
          placeholder="https://apps.apple.com/app/dotinout/idXXXXXXXXX"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Input
          label="Business registration link (mobile login screen)"
          value={registrationUrl}
          onChange={setRegistrationUrl}
          placeholder="https://dotinout.com"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-slate-500">Leave it empty to use https://dotinout.com.</p>
        <div className="flex justify-end">
          <Button onClick={saveLinks} loading={busy === "links"}>Save links</Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-bold text-slate-900">Direct downloads</h2>
          <p className="text-sm text-slate-500">
            Upload the Android package (.apk) and the iOS package (.ipa). A platform with no file shows no direct download
            button. Files up to 150 MB.
          </p>
        </div>
        {(["android", "ios"] as const).map((platform) => {
          const file = data?.files[platform] ?? null;
          const label = platform === "android" ? "Android (.apk)" : "iOS (.ipa)";
          return (
            <div key={platform} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{label}</p>
                {file ? (
                  <p className="truncate text-sm text-slate-600">
                    {file.fileName} · {formatSize(file.sizeBytes)} · uploaded {new Date(file.uploadedAt).toLocaleDateString()}
                  </p>
                ) : (
                  <Badge tone="slate">No file uploaded</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                  {busy === `upload-${platform}` ? "Uploading…" : file ? "Replace file" : "Upload file"}
                  <input
                    type="file"
                    accept={platform === "android" ? ".apk,application/vnd.android.package-archive" : ".ipa"}
                    className="sr-only"
                    disabled={busy !== null}
                    onChange={(e) => {
                      void uploadFile(platform, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {file && (
                  <Button variant="secondary" onClick={() => removeFile(platform)} loading={busy === `remove-${platform}`}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
