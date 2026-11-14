"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { NOTIFICATIONS_CHANGED } from "@/lib/notifications";
import type { AgreementStatus } from "@/lib/agreements";

/** One agreement as the employee sees it (from GET /api/agreements). */
export interface AgreementDto {
  id: string;
  title: string;
  body: string;
  version: number;
  publishedAt: string | null;
  status: AgreementStatus;
  popup: boolean;
  blocksPunch: boolean;
}

/**
 * The agreement text with the employee's answer. Accept (optionally "Don't show again") or Decline.
 * A decline needs a second tap, because it stops the employee punching in for the rest of the day.
 */
export default function AgreementCard({
  agreement,
  onAnswered,
  onClose,
}: {
  agreement: AgreementDto;
  onAnswered: (status: string) => void;
  /** Used when the employee already declined today: the only thing left to do is close. */
  onClose?: () => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [busy, setBusy] = useState<"" | "accepted" | "declined">("");
  const [error, setError] = useState("");

  const declinedToday = agreement.status === "declined_today";
  const alreadyAccepted = agreement.status === "accepted_today" || agreement.status === "permanent";

  const respond = async (response: "accepted" | "declined") => {
    setBusy(response);
    setError("");
    try {
      const result = await api<{ status: string }>("/api/agreements/respond", {
        method: "POST",
        body: JSON.stringify({ agreementId: agreement.id, response, dontShowAgain: response === "accepted" && dontShowAgain }),
      });
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      onAnswered(result.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answer. Please try again.");
    } finally {
      setBusy("");
      setConfirmDecline(false);
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{agreement.title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Version {agreement.version}
        {agreement.publishedAt ? ` · Pushed ${formatDate(agreement.publishedAt)}` : ""}
      </p>

      <div className="mt-4 whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
        {agreement.body}
      </div>

      {declinedToday ? (
        <div className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          You declined this agreement today, so punching in is blocked until tomorrow. You will be asked again when you open the app tomorrow.
          {onClose && (
            <div className="mt-3">
              <Button variant="secondary" onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      ) : alreadyAccepted ? (
        <div className="mt-5 space-y-3">
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {agreement.status === "permanent"
              ? "You accepted this agreement. It will not be shown again unless it is updated."
              : "You accepted this agreement for today. You can punch in."}
          </p>
          {onClose && (
            <Button variant="secondary" onClick={onClose} className="w-full">
              Close
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
            />
            <span className="text-sm text-slate-700">
              <span className="font-semibold">Don&apos;t show again.</span> I will only be asked again if this agreement is updated.
              Leave it unticked and you will see this every time you open the app.
            </span>
          </label>

          {confirmDecline ? (
            <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-200">
              <p className="text-sm font-semibold text-rose-800">Decline this agreement?</p>
              <p className="mt-1 text-xs text-rose-700">You will not be able to punch in for the rest of today.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmDecline(false)} disabled={!!busy}>
                  Go back
                </Button>
                <Button variant="danger" onClick={() => respond("declined")} loading={busy === "declined"}>
                  Yes, decline
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="secondary" size="lg" onClick={() => setConfirmDecline(true)} disabled={!!busy}>
                Decline
              </Button>
              <Button variant="success" size="lg" onClick={() => respond("accepted")} loading={busy === "accepted"}>
                Accept and continue
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
    </div>
  );
}
