"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { AGREEMENTS_CHANGED } from "@/lib/notifications";
import AgreementCard, { type AgreementDto } from "@/components/AgreementCard";

/**
 * Full-screen pop-up for employees. It opens every time the app opens, for each agreement that is not yet
 * accepted permanently, and again whenever a punch is blocked. Employees must answer each one before carrying on.
 * If the request fails the app is not blocked: the server still refuses the punch.
 */
export default function AgreementGate() {
  const [queue, setQueue] = useState<AgreementDto[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ agreements: AgreementDto[] }>("/api/agreements");
      const pending = data.agreements.filter((a) => a.popup);
      setQueue(pending);
      setIndex(0);
      setOpen(pending.length > 0);
    } catch {
      // Stay quiet: a network blip must not lock the app. The punch itself is still checked on the server.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(AGREEMENTS_CHANGED, onChanged);
    return () => window.removeEventListener(AGREEMENTS_CHANGED, onChanged);
  }, [load]);

  if (!open || queue.length === 0) return null;
  const current = queue[index];
  if (!current) return null;

  const next = () => {
    if (index + 1 < queue.length) setIndex(index + 1);
    else setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Company agreement">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">Please read and respond</p>
          <p className="text-sm font-semibold text-slate-700">
            Agreement {index + 1} of {queue.length}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-2xl">
          <AgreementCard
            key={`${current.id}:${current.version}`}
            agreement={current}
            onAnswered={() => next()}
            onClose={() => next()}
          />
        </div>
      </div>
    </div>
  );
}
