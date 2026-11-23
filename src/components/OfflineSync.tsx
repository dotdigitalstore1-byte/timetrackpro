"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useMe } from "@/lib/client";
import { useIsOnline } from "@/lib/offline/network";
import { flushOutbox } from "@/lib/offline/outbox";
import { failedList, failedWrite, OFFLINE_CHANGED_EVENT, outboxList } from "@/lib/offline/store";

const subscribeOffline = (cb: () => void) => {
  window.addEventListener(OFFLINE_CHANGED_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(OFFLINE_CHANGED_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const noSnapshot = () => "";
const snapshotQueue = () => JSON.stringify([outboxList().length, failedList().length]);

/**
 * Online/offline signalling and automatic sync. Mounted once inside the signed-in shell.
 * Queued actions are sent when the connection returns, in order, each with its idempotency key.
 */
export default function OfflineSync() {
  const { me } = useMe();
  const online = useIsOnline();
  const queueState = useSyncExternalStore(subscribeOffline, snapshotQueue, noSnapshot);
  const [sending, setSending] = useState(false);
  const [pending, failed] = (() => {
    try {
      return JSON.parse(queueState || "[0,0]") as [number, number];
    } catch {
      return [0, 0] as [number, number];
    }
  })();

  const sync = useCallback(async () => {
    if (!me || !navigator.onLine) return;
    if (outboxList().length === 0) return;
    setSending(true);
    try {
      await flushOutbox(me.user.id);
    } finally {
      setSending(false);
    }
  }, [me]);

  // Send as soon as the device reconnects, when the app opens, and periodically while online.
  useEffect(() => {
    void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void sync(), 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [sync]);

  if (online && pending === 0 && failed === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-40 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {!online && (
          <div className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg">
            You&apos;re offline. Showing saved data.
            {pending > 0 && ` ${pending} request${pending === 1 ? "" : "s"} will send when you reconnect.`}
          </div>
        )}
        {online && pending > 0 && (
          <div className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {sending ? "Sending saved requests…" : `${pending} saved request${pending === 1 ? "" : "s"} waiting to send.`}
          </div>
        )}
        {failed > 0 && (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-600 px-4 py-2 text-sm text-white shadow-lg">
            <div>
              <p className="font-semibold">
                {failed} saved request{failed === 1 ? " was" : "s were"} not accepted
              </p>
              {failedList()
                .slice(0, 3)
                .map((f) => (
                  <p key={f.id} className="text-rose-100">
                    {f.label}: {f.error}
                  </p>
                ))}
            </div>
            <button
              type="button"
              onClick={() => failedWrite([])}
              className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
