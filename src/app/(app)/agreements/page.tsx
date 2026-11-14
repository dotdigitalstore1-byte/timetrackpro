"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Textarea } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { AGREEMENT_BODY_MAX, AGREEMENT_TITLE_MAX } from "@/lib/agreements";

interface AgreementRow {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  stats: { accepted: number; declinedToday: number } | null;
}

export default function AgreementsPage() {
  const { me } = useMe();
  const isAdmin = me?.user.role === "company_admin";

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [staffCount, setStaffCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");

  // editor
  const [editing, setEditing] = useState<AgreementRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState<"" | "draft" | "push">("");
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ agreements: AgreementRow[]; staffCount: number }>("/api/agreements");
      setRows(data.agreements);
      setStaffCount(data.staffCount);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load agreements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else if (me) setLoading(false);
  }, [isAdmin, me, load]);

  const openNew = () => {
    setEditing(null);
    setCreating(true);
    setTitle("");
    setBody("");
    setFormError("");
  };

  const openEdit = (row: AgreementRow) => {
    setEditing(row);
    setCreating(false);
    setTitle(row.title);
    setBody(row.body);
    setFormError("");
  };

  const closeEditor = () => {
    setEditing(null);
    setCreating(false);
    setFormError("");
  };

  const editorOpen = creating || !!editing;
  const isLive = editing?.status === "published";

  /** Saves the text. Returns the agreement id (new or existing), or null when saving failed. */
  const persist = async (): Promise<string | null> => {
    const t = title.trim();
    const b = body.trim();
    if (!t) {
      setFormError("Give the agreement a title.");
      return null;
    }
    if (!b) {
      setFormError("Write the agreement text before saving.");
      return null;
    }
    if (t.length > AGREEMENT_TITLE_MAX) {
      setFormError(`The title can be at most ${AGREEMENT_TITLE_MAX} characters.`);
      return null;
    }
    if (b.length > AGREEMENT_BODY_MAX) {
      setFormError(`The agreement text can be at most ${AGREEMENT_BODY_MAX} characters.`);
      return null;
    }
    if (editing) {
      await api("/api/agreements", { method: "POST", body: JSON.stringify({ action: "update", id: editing.id, title: t, body: b }) });
      return editing.id;
    }
    const created = await api<{ id: string }>("/api/agreements", {
      method: "POST",
      body: JSON.stringify({ action: "create", title: t, body: b }),
    });
    return created.id;
  };

  const saveDraft = async () => {
    setSaving("draft");
    setFormError("");
    try {
      const id = await persist();
      if (!id) return;
      setMessage(isLive ? "Changes saved." : "Draft saved. Employees cannot see it until you push it.");
      closeEditor();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving("");
    }
  };

  /** Pushes the agreement to every employee. Editing a live agreement pushes a new version automatically. */
  const push = async () => {
    if (isLive) {
      if (!window.confirm("Push this update to all employees? Everyone will be asked to accept it again.")) return;
    }
    setSaving("push");
    setFormError("");
    try {
      const id = await persist();
      if (!id) return;
      if (!isLive) {
        await api("/api/agreements", { method: "POST", body: JSON.stringify({ action: "publish", id }) });
        setMessage("Pushed. Employees will see the agreement the next time they open the app.");
      } else {
        setMessage("Update pushed. Employees will be asked to accept the new version.");
      }
      closeEditor();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not push the agreement");
    } finally {
      setSaving("");
    }
  };

  const withdraw = async (row: AgreementRow) => {
    if (!window.confirm(`Withdraw "${row.title}"? Employees will no longer be asked to accept it.`)) return;
    setMessage("");
    try {
      await api("/api/agreements", { method: "POST", body: JSON.stringify({ action: "withdraw", id: row.id }) });
      setMessage("Agreement withdrawn. It is now a draft.");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not withdraw the agreement");
    }
  };

  const remove = async (row: AgreementRow) => {
    if (!window.confirm(`Delete the draft "${row.title}"? This cannot be undone.`)) return;
    setMessage("");
    try {
      await api("/api/agreements", { method: "POST", body: JSON.stringify({ action: "delete", id: row.id }) });
      setMessage("Draft deleted.");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not delete the draft");
    }
  };

  const pushDraft = async (row: AgreementRow) => {
    if (!window.confirm(`Push "${row.title}" to all employees now?`)) return;
    setMessage("");
    try {
      await api("/api/agreements", { method: "POST", body: JSON.stringify({ action: "publish", id: row.id }) });
      setMessage("Pushed. Employees will see it the next time they open the app.");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not push the agreement");
    }
  };

  if (me && !isAdmin) {
    return (
      <div>
        <PageHeader title="Agreements" />
        <EmptyState message="Only the company admin manages agreements." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Agreements & rules"
        subtitle="Write company rules or agreements and push them to employees. They must accept each one to punch in."
        action={
          <Button onClick={openNew}>
            <span aria-hidden="true">+</span> New agreement
          </Button>
        }
      />

      {loadError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{loadError}</p>}
      {message && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}

      <Card className="mb-5 bg-indigo-50/60 ring-indigo-100">
        <h3 className="font-bold text-indigo-900">How this works for employees</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-indigo-900/80">
          <li>When you push an agreement, employees see it as a full-screen pop-up the next time they open the app.</li>
          <li>They must accept it to punch in. Declining blocks punching in for that day only.</li>
          <li>Accepting for today means it appears again on the next open. &ldquo;Don&apos;t show again&rdquo; keeps it hidden until you update it.</li>
          <li>Editing a live agreement pushes the new text, and everyone is asked to accept it again.</li>
        </ul>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message="No agreements yet. Create one to share a rule or policy with your team." />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-bold text-slate-900">{row.title}</h3>
                    {row.status === "published" ? (
                      <Badge tone="green">Live · v{row.version}</Badge>
                    ) : (
                      <Badge tone="slate">Draft</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.status === "published" && row.publishedAt
                      ? `Pushed ${formatDate(row.publishedAt)}`
                      : `Last edited ${formatDate(row.updatedAt)}`}
                  </p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{row.body}</p>
                  {row.stats && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
                        {row.stats.accepted} of {staffCount} accepted
                      </span>
                      {row.stats.declinedToday > 0 && (
                        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700 ring-1 ring-rose-200">
                          {row.stats.declinedToday} declined today
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                  Edit
                </Button>
                {row.status === "draft" ? (
                  <>
                    <Button size="sm" variant="success" onClick={() => pushDraft(row)}>
                      Push to employees
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(row)} className="text-rose-600 hover:bg-rose-50">
                      Delete
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => withdraw(row)}>
                    Withdraw
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={editorOpen} onClose={closeEditor} title={editing ? (isLive ? "Edit live agreement" : "Edit draft") : "New agreement"}>
        <div className="space-y-3">
          {isLive && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              This agreement is live. Saving changes pushes a new version, and everyone is asked to accept it again.
            </p>
          )}
          <Input label="Title" value={title} onChange={setTitle} placeholder="e.g. Code of conduct 2026" />
          <Textarea
            label="Agreement text"
            value={body}
            onChange={setBody}
            rows={12}
            placeholder={"Write the rule or agreement. Line breaks are kept.\n\nExample:\n1. Punch in only from your assigned work location.\n2. Report any absence before your shift starts."}
          />
          <p className="text-right text-[11px] text-slate-400">
            {body.length.toLocaleString("en-IN")} / {AGREEMENT_BODY_MAX.toLocaleString("en-IN")}
          </p>

          {formError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{formError}</p>}

          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={closeEditor} disabled={!!saving}>
              Cancel
            </Button>
            {!isLive && (
              <Button variant="secondary" onClick={saveDraft} loading={saving === "draft"} disabled={!!saving}>
                Save draft
              </Button>
            )}
            <Button variant="success" onClick={push} loading={saving === "push"} disabled={!!saving}>
              {isLive ? "Save and push update" : "Push to employees"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
