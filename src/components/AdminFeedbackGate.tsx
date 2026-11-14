"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button, Spinner } from "@/components/ui";

interface QuestionDto {
  id: string;
  text: string;
  options: { key: string; label: string }[];
}

interface FeedbackDue {
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
 * A full-screen check-in for company admins, delivered about three times a payroll cycle (once per third of the cycle).
 * The awareness message scrolls inside its own box. The questions are shown straight below it, and the checkboxes
 * stay locked until the message has been read to the end. "Answer later" closes it for this visit only, so the
 * prompt comes back the next time the app opens while the slot is still open.
 */
export default function AdminFeedbackGate() {
  const [data, setData] = useState<FeedbackDue | null>(null);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const awarenessRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<FeedbackDue>("/api/feedback")
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setOpen(d.due);
      })
      .catch(() => {
        // Stay quiet on failure: the check-in is not worth blocking the admin's work over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // If the message fits on screen without scrolling, it counts as read as soon as it is shown.
  useEffect(() => {
    const el = awarenessRef.current;
    if (!open || !el) return;
    if (el.scrollHeight <= el.clientHeight + 8) setRead(true);
  }, [open, data]);

  if (!open || !data || !data.due || done) return null;
  const q = data.questionnaire;

  const onAwarenessScroll = () => {
    const el = awarenessRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setRead(true);
  };

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
    setError("");
    setSaving(true);
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ answers, scrolledToEnd: read, confirmed }),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answers. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white p-6">
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

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Periodic check-in">
      <header className="border-b border-slate-200 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">Periodic check-in · {data.slotLabel}</p>
            <h1 className="text-lg font-bold leading-tight text-slate-900 sm:text-xl">{q.awarenessTitle}</h1>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* 1. Awareness message: its own scroll box */}
          <section aria-label="Awareness message">
            <div
              ref={awarenessRef}
              onScroll={onAwarenessScroll}
              className="max-h-[32vh] overflow-y-auto whitespace-pre-line rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200 sm:max-h-[280px] sm:p-5"
              tabIndex={0}
            >
              {q.awarenessText}
            </div>
            <p className={read ? "mt-2 text-xs font-semibold text-emerald-700" : "mt-2 text-xs font-medium text-amber-700"}>
              {read
                ? "You have read the message. The questions below are now unlocked."
                : "Scroll to the end of the message to unlock the questions."}
            </p>
          </section>

          {/* 2. Highlighted questions and 3. checkboxes directly below */}
          <section aria-label="Questions" className="space-y-4">
            {q.questions.map((question, i) => (
              <div key={question.id} className="rounded-2xl border-l-4 border-amber-400 bg-amber-50/70 p-4 ring-1 ring-amber-200 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Question {i + 1} of {q.questions.length}</p>
                <p className="mt-1 text-base font-bold leading-snug text-slate-900">{question.text}</p>
                <p className="mt-1 text-xs text-slate-500">Tick every option that describes what you do today.</p>

                <div className="mt-3 space-y-2">
                  {question.options.map((o) => {
                    const checked = (answers[question.id] ?? []).includes(o.key);
                    return (
                      <label
                        key={o.key}
                        className={[
                          "flex items-start gap-3 rounded-xl bg-white p-3 ring-1 transition",
                          read ? "cursor-pointer ring-slate-200 hover:ring-indigo-300" : "cursor-not-allowed opacity-60 ring-slate-200",
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
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-white px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-3">
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

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving} className="sm:order-1">
              Answer later
            </Button>
            <Button onClick={submit} disabled={!canSubmit} loading={saving} className="sm:min-w-[220px]">
              Submit anonymous answers
            </Button>
          </div>
          {!answeredAll && read && <p className="text-center text-xs text-slate-500">{`Answer all ${q.questions.length} questions to submit.`}</p>}
        </div>
      </footer>

      {saving && (
        <div className="pointer-events-none fixed right-4 top-4 rounded-full bg-white p-2 shadow">
          <Spinner />
        </div>
      )}
    </div>
  );
}
