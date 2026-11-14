"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Modal, Spinner } from "@/components/ui";
import AgreementCard, { type AgreementDto } from "@/components/AgreementCard";
import { NOTIFICATIONS_CHANGED, OPEN_CHECKIN_EVENT, type NotificationItem } from "@/lib/notifications";

const TONE_DOT: Record<NotificationItem["tone"], string> = {
  indigo: "bg-indigo-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  slate: "bg-slate-400",
};

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/**
 * The bell in the top corner of every page (the home page included). Shows unread items. Opening it lists
 * agreements, the outcome of notice / leave / salary-slip requests, and (for admins) work waiting for a decision.
 */
export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<AgreementDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ items: NotificationItem[]; unreadCount: number }>("/api/notifications");
      setItems(data.items);
      setCount(data.unreadCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
  }, [load]);

  const openCentre = async () => {
    setOpen(true);
    await load();
    // Opening the centre marks everything as read; items that still need an answer stay highlighted.
    try {
      await api("/api/notifications", { method: "POST", body: JSON.stringify({ action: "mark_seen" }) });
      setCount(0);
    } catch {
      // Not critical: the badge will clear next time.
    }
  };

  const openAgreement = async (agreementId: string) => {
    try {
      const data = await api<{ agreements: AgreementDto[] }>("/api/agreements");
      const found = data.agreements.find((a) => a.id === agreementId);
      if (found) setViewing(found);
      else setError("That agreement is no longer published.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the agreement");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openCentre}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[45]">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Notifications</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close notifications"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && !items && (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              )}
              {error && <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
              {items && items.length === 0 && (
                <p className="px-6 py-14 text-center text-sm text-slate-500">You are all caught up. Nothing new right now.</p>
              )}
              {items && items.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const body = (
                      <div className="flex items-start gap-3">
                        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", TONE_DOT[item.tone], !item.unread && "opacity-30")} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm text-slate-900", item.unread ? "font-bold" : "font-semibold")}>{item.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.body}</p>
                        </div>
                        <span className="shrink-0 text-[11px] font-medium text-slate-400">{when(item.at)}</span>
                      </div>
                    );
                    const rowClass = "block w-full px-5 py-4 text-left hover:bg-slate-50";
                    return (
                      <li key={item.id}>
                        {item.action === "open_checkin" ? (
                          <button
                            type="button"
                            className={rowClass}
                            onClick={() => {
                              setOpen(false);
                              window.dispatchEvent(new Event(OPEN_CHECKIN_EVENT));
                            }}
                          >
                            {body}
                          </button>
                        ) : item.agreementId ? (
                          <button type="button" className={rowClass} onClick={() => void openAgreement(item.agreementId!)}>
                            {body}
                          </button>
                        ) : item.href ? (
                          <Link href={item.href} className={rowClass} onClick={() => setOpen(false)}>
                            {body}
                          </Link>
                        ) : (
                          <div className="px-5 py-4">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Company agreement">
        {viewing && (
          <AgreementCard
            agreement={viewing}
            onAnswered={() => {
              setViewing(null);
              void load();
            }}
            onClose={() => setViewing(null)}
          />
        )}
      </Modal>
    </>
  );
}
