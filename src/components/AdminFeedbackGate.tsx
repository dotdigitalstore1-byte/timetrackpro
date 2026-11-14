"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button, Spinner } from "@/components/ui";
import { NOTIFICATIONS_CHANGED, OPEN_CHECKIN_EVENT } from "@/lib/notifications";

interface QuestionDto {
  id: string;
  text: string;
  options: { key: string; label: string }[];
}

interface FeedbackState {
  due: boolean;
  slotLabel: string;
  questionnaire: {
    version: number;
    awarenessTitle: string;
    awarenessText: string;
    questions: QuestionDto[];
  };
}

/**
 * Periodic check-in for company admins, about three times per payroll cycle.
 *
 * One page, one scroll. There are no nested scroll boxes: the awareness message comes first, then the highlighted
 * questions and their tick-boxes, then the submit area. The tick-boxes unlock once the reader has scrolled down to the
 * end of the message, so the message is always seen first.
 *
 * It opens on app load when a check-in is due, and again whenever the admin taps the check-in in Notifications.
 * "Answer later" closes it for this visit only. The notification stays until the slot is answered.
 */
export default function AdminFeedbackGate() {
  const [data, setData] = useState<FeedbackState | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [read, setRead] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  /** Fetches whether a check-in is due. Quiet on failure unless the admin asked for it (from Notifications). */
  const load = useCallback(async (userInitiated: boolean) => {
    setLoading(true);
    setLoadError("");
    try {
      const d = await api<FeedbackState>("/api/feedback");
      setData(d);
      if (d.due) {
        setOpen(true);
        setDone(false);
      } else if (userInitiated) {
        setOpen(false);
      }
    } catch (e) {
      if (userInitiated) {
        setOpen(true);
        setLoadError(e instanceof Error ? e.message : "Could not load the check-in.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onOpen = () => {
      setRead(false);
      setAnswers({});
      setConfirmed(false);
      setSubmitError("");
      setDone(false);
      setOpen(true);
      void load(true);
    };
    window.addEventListener(OPEN_CHECKIN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHECKIN_EVENT, onOpen);
  }, [load]);

  /** Unlocks the questions once the end of the awareness message is on screen, or when the page is too short to scroll. */
  const checkRead = useCallback(() => {
    const el = endRef.current;
    if (!el) return;
    const reachedEnd = el.getBoundingClientRect().top <= window.innerHeight - 80;
    const fitsOnScreen = document.documentElement.scrollHeight <= window.innerHeight + 4;
    if (reachedEnd || fitsOnScreen) setRead(true);
  }, []);

  useEffect(() => {
    if (!open || !data?.due || done) return;
    window.addEventListener("scroll", checkRead, { passive: true });
    checkRead();
    return () => window.removeEventListener("scroll", checkRead);
  }, [open, data, done, checkRead]);

  if (!open) return null;

  if (done) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-white p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">Thank you</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your answers are saved anonymously and help us understand what supports fair attendance across companies.
          </p>
          <Button className="mt-6 w-full" onClick={() => setOpen(false)}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if (!data || !data.due) {
    // Opened from Notifications, but the data is not ready yet, or it failed. Say so and offer a retry.
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-white p-6" role="dialog" aria-modal="true">
        <div className="max-w-sm text-center">
          {loading ? (
            <Spinner />
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">{loadError || "There is no check-in waiting right now."}</p>
              <div className="mt-4 grid gap-2">
                {loadError && <Button onClick={() => void load(true)}>Try again</Button>}
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const q = data.questionnaire;
  const toggle = (qid: string, key: string) => {
    if (!read) return;
    setAnswers((prev) => {
      const current = prev[qid] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, [qid]: next };
    });
  };

  const answeredAll = q.questions.every((question) => (answers[question.id] ?? []).length > 0);
  const canSubmit = read && answeredAll && confirmed && !saving;

  const submit = async () => {
    setSubmitError("");
    setSaving(true);
    try {
      await api("/api/feedback", { method: "POST", body: JSON.stringify({ answers, scrolledToEnd: read, confirmed }) });
      setDone(true);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save your answers. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    // One scroll container for the whole check-in. Nothing inside it scrolls on its own.
    <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-white" role="dialog" aria-modal="true" aria-label="Periodic check-in">
      <div className="mx-auto max-w-3xl px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-8">
        <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">Periodic check-in · {data.slotLabel}</p>
        <h1 className="mt-1 text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{q.awarenessTitle}</h1>
        <p className="mt-2 text-sm text-slate-500">Please read the message below first. The questions unlock when you reach its end.</p>

        {/* 1. Awareness message */}
        <section aria-label="Awareness message" className="mt-5">
          <div className="whitespace-pre-line rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200 sm:p-6 sm:text-[15px]">
            {q.awarenessText}
          </div>
          {/* Marks the end of the message. Reaching it unlocks the questions. */}
          <div ref={endRef} aria-hidden="true" className="h-px" />
          <p className={read ? "mt-3 text-xs font-semibold text-emerald-700" : "mt-3 text-xs font-medium text-amber-700"}>
            {read ? "You have reached the end of the message. The questions are unlocked." : "Keep scrolling to the end of the message to unlock the questions."}
          </p>
        </section>

        {/* 2. Highlighted questions, 3. checkboxes directly below each one */}
        <section aria-label="Questions" className="mt-8">
          <h2 className="text-base font-bold text-slate-900">Your company&apos;s current policies</h2>
          <p className="mt-1 text-xs text-slate-500">Tick every option that describes what your company does today, not what you intend to do.</p>

          <div className="mt-4 space-y-4">
            {q.questions.map((question, i) => (
              <div key={question.id} className="rounded-2xl border-l-4 border-amber-400 bg-amber-50/70 p-4 ring-1 ring-amber-200 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                  Question {i + 1} of {q.questions.length}
                </p>
                <p className="mt-1 text-base font-bold leading-snug text-slate-900">{question.text}</p>

                <div className="mt-3 space-y-2">
                  {question.options.map((o) => {
                    const checked = (answers[question.id] ?? []).includes(o.key);
                    return (
                      <label
                        key={o.key}
                        className={[
                          "flex items-start gap-3 rounded-xl bg-white p-3 ring-1 transition",
                          !read ? "cursor-not-allowed opacity-60 ring-slate-200" : "cursor-pointer ring-slate-200 hover:ring-indigo-300",
                          checked ? "ring-2 ring-indigo-500" : "",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!read}
                          onChange={() => toggle(question.id, o.key)}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
                        />
                        <span className="text-sm text-slate-700">{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4. Confirmation and submit, still on the same page */}
        <section aria-label="Submit" className="mt-8 space-y-3 border-t border-slate-200 pt-6">
          <label className={["flex items-start gap-3 text-sm text-slate-700", read ? "cursor-pointer" : "cursor-not-allowed opacity-60"].join(" ")}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!read}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
            />
            <span>I confirm these answers reflect the policies we apply today.</span>
          </label>

          {submitError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{submitError}</p>}
          {read && !answeredAll && <p className="text-xs text-slate-500">{`Answer all ${q.questions.length} questions to submit.`}</p>}

          <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-[auto_1fr]">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving} className="sm:order-1">
              Answer later
            </Button>
            <Button onClick={submit} disabled={!canSubmit} loading={saving}>
              Submit anonymous answers
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
