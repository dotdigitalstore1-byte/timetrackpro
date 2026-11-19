"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, Textarea } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

interface OpenRow {
  id: string;
  paidAt: string | null;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  total: number;
  commissionPercent: number;
  commissionAmount: number;
  releaseCount: number;
}

interface MineRow {
  id: string;
  status: "claimed" | "awaiting_rating" | "completed";
  claimedAt: string | null;
  completedAt: string | null;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  total: number;
  commissionPercent: number;
  commissionAmount: number | null;
  satisfaction: number | null;
  flagReason: string | null;
  delayed: boolean;
  client: { companyName: string; whatsapp: string; email: string; call: string } | null;
}

interface QueueData {
  me: { id: string; name: string; email: string; phone: string; photoDataUrl: string | null };
  commissionPercent: number;
  benchmark: number;
  earnings: { month: string; completed: number; commission: number; averageSatisfaction: number | null; belowBenchmark: boolean };
  open: OpenRow[];
  mine: MineRow[];
}

const STATUS_LABEL: Record<MineRow["status"], { label: string; tone: "indigo" | "sky" | "green" }> = {
  claimed: { label: "In progress", tone: "indigo" },
  awaiting_rating: { label: "Waiting for client rating", tone: "sky" },
  completed: { label: "Completed", tone: "green" },
};

function services(r: { includeOnboarding: boolean; includeEmployees: boolean; employeeCount: number }) {
  const parts: string[] = [];
  if (r.includeOnboarding) parts.push("Onboarding");
  if (r.includeEmployees) parts.push(`${r.employeeCount} employee${r.employeeCount === 1 ? "" : "s"} to add`);
  return parts.join(" + ");
}

const digitsOnly = (v: string) => v.replace(/[^\d]/g, "");

export default function SpecialistQueuePage() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"open" | "mine" | "done">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<MineRow | null>(null);
  const [flagText, setFlagText] = useState("");
  const [releasing, setReleasing] = useState<OpenRow | MineRow | null>(null);
  const [releaseNote, setReleaseNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<QueueData>("/api/specialist"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>, success: string) => {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await api(`/api/specialist/requests/${id}`, { method: "POST", body: JSON.stringify(body) });
      setNotice(success);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
      await load(); // another specialist may have claimed it; refresh the queue
    } finally {
      setBusyId(null);
    }
  };

  const mine: MineRow[] = data?.mine ?? [];
  const active: MineRow[] = mine.filter((r) => r.status === "claimed");
  const finished: MineRow[] = mine.filter((r) => r.status !== "claimed");

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <PageHeader title="Onboarding queue" subtitle="Accept a request to unlock the client's contact details." />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p>}

      {loading && !data && <div className="flex justify-center py-12"><Spinner /></div>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Earned this month</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatMoney(data.earnings.commission, 2)}</p>
              <p className="text-xs text-slate-500">{data.earnings.completed} completed · commission {data.commissionPercent}%</p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average satisfaction</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {data.earnings.averageSatisfaction === null ? "—" : `${data.earnings.averageSatisfaction}%`}
              </p>
              <div className="mt-1">
                {data.earnings.averageSatisfaction === null ? (
                  <span className="text-xs text-slate-500">No ratings yet</span>
                ) : data.earnings.belowBenchmark ? (
                  <Badge tone="red">Below {data.benchmark}% benchmark</Badge>
                ) : (
                  <Badge tone="green">Meets {data.benchmark}% benchmark</Badge>
                )}
              </div>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In your hands</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{active.length}</p>
              <p className="text-xs text-slate-500">{data.open.length} open in the queue</p>
            </Card>
          </div>

          <div role="tablist" className="flex gap-2 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["open", `Open queue (${data.open.length})`],
                ["mine", `My work (${active.length})`],
                ["done", `Completed (${finished.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "open" && (
            <section className="space-y-3">
              {data.open.length === 0 && <EmptyState message="No open requests right now. New paid requests appear here." />}
              {data.open.map((r) => (
                <Card key={r.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{services(r)}</p>
                      <p className="text-xs text-slate-500">
                        Paid {formatMoney(r.total, 2)}
                        {r.paidAt ? ` · ${new Date(r.paidAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                      </p>
                    </div>
                    {r.releaseCount > 0 && <Badge tone="amber">Released {r.releaseCount}×</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Your commission</p>
                      <p className="font-bold text-slate-900">{formatMoney(r.commissionAmount, 2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Rate</p>
                      <p className="font-bold text-slate-900">{r.commissionPercent}%</p>
                    </div>
                  </div>
                  <Button onClick={() => void act(r.id, { action: "claim" }, "Request accepted. The client's details are now unlocked.")} loading={busyId === r.id} className="w-full">
                    Accept request
                  </Button>
                </Card>
              ))}
            </section>
          )}

          {tab === "mine" && (
            <section className="space-y-3">
              {active.length === 0 && <EmptyState message="You have no requests in progress. Accept one from the open queue." />}
              {active.map((r) => (
                <Card key={r.id} className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-bold text-slate-900">{r.client?.companyName}</p>
                      <p className="text-sm text-slate-600">{services(r)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.delayed && <Badge tone="red">Delayed</Badge>}
                      {r.flagReason && <Badge tone="amber">Flagged</Badge>}
                    </div>
                  </div>

                  {r.client && (
                    <div className="grid gap-2 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-3">
                      <a href={`https://wa.me/${digitsOnly(r.client.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="min-h-[44px] rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-700">
                        WhatsApp {r.client.whatsapp}
                      </a>
                      <a href={`mailto:${r.client.email}`} className="min-h-[44px] break-all rounded-lg bg-indigo-50 px-3 py-2 font-semibold text-indigo-700">
                        {r.client.email}
                      </a>
                      <a href={`tel:${r.client.call}`} className="min-h-[44px] rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-700">
                        Call {r.client.call}
                      </a>
                    </div>
                  )}

                  {r.flagReason && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Your flag: {r.flagReason}</p>}

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button onClick={() => void act(r.id, { action: "complete" }, "Marked complete. The client has been asked to rate it.")} loading={busyId === r.id}>
                      Mark complete
                    </Button>
                    <Button variant="secondary" onClick={() => { setFlagging(r); setFlagText(r.flagReason ?? ""); }}>
                      Flag an issue
                    </Button>
                    <Button variant="danger" onClick={() => { setReleasing(r); setReleaseNote(""); }}>
                      Release
                    </Button>
                  </div>
                </Card>
              ))}
            </section>
          )}

          {tab === "done" && (
            <section className="space-y-3">
              {finished.length === 0 && <EmptyState message="Completed requests will show here with their rating and commission." />}
              {finished.map((r) => {
                const s = STATUS_LABEL[r.status];
                return (
                  <Card key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{services(r)}</p>
                      <p className="text-xs text-slate-500">
                        {r.completedAt ? new Date(r.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}
                        {r.satisfaction !== null ? ` · satisfaction ${r.satisfaction}%` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <p className="mt-1 text-sm font-bold text-slate-900">{r.commissionAmount !== null ? formatMoney(r.commissionAmount, 2) : "—"}</p>
                    </div>
                  </Card>
                );
              })}
            </section>
          )}
        </>
      )}

      <Modal open={!!flagging} onClose={() => setFlagging(null)} title="Flag an issue">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Let the platform team know what is holding this onboarding back (for example, the client is not responding).</p>
          <Textarea label="What is the issue?" value={flagText} onChange={setFlagText} rows={3} placeholder="Describe the issue" />
          <Button
            className="w-full"
            loading={busyId === flagging?.id}
            onClick={async () => {
              if (!flagging) return;
              await act(flagging.id, { action: "flag", reason: flagText }, "Issue flagged for the platform team.");
              setFlagging(null);
            }}
          >
            Save flag
          </Button>
        </div>
      </Modal>

      <Modal open={!!releasing} onClose={() => setReleasing(null)} title="Release this request">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            It goes straight back to the shared queue for another specialist. Only release it if you cannot complete it.
          </p>
          <Textarea label="Reason (optional)" value={releaseNote} onChange={setReleaseNote} rows={2} placeholder="Why are you releasing it?" />
          <Button
            variant="danger"
            className="w-full"
            loading={busyId === releasing?.id}
            onClick={async () => {
              if (!releasing) return;
              await act(releasing.id, { action: "release", note: releaseNote }, "Request released back to the queue.");
              setReleasing(null);
              setTab("open");
            }}
          >
            Release to queue
          </Button>
        </div>
      </Modal>
    </div>
  );
}
