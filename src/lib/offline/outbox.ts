"use client";

import { failedList, failedWrite, outboxList, outboxWrite, type OutboxItem } from "@/lib/offline/store";

let flushing: Promise<FlushResult> | null = null;

export interface FlushResult {
  sent: number;
  failed: number;
  pending: number;
}

/** A fresh idempotency key. crypto.randomUUID exists in every supported WebView; the fallback is for older engines. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Adds an action to the device queue. The caller has already shown the user that it is saved for later. */
export function enqueueOfflineAction(item: Omit<OutboxItem, "createdAt" | "attempts">): void {
  const list = outboxList();
  if (list.some((existing) => existing.id === item.id)) return; // never queue the same action twice
  outboxWrite([...list, { ...item, createdAt: Date.now(), attempts: 0 }]);
}

/**
 * Sends queued actions for one user, oldest first, with their idempotency key.
 * - Network failure or server busy (5xx) or session expired (401): keep the item and stop, it will be retried.
 * - Validation or permission rejection (400/403/404/409/422): move it to the "could not send" list so the user sees it.
 * - Success, or a replay the server already processed: remove it.
 */
export function flushOutbox(userId: string): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let failed = 0;
    let stop = false;
    const queue = outboxList();
    const remaining: OutboxItem[] = [];

    for (const item of queue) {
      if (stop || item.userId !== userId) {
        remaining.push(item);
        continue;
      }
      try {
        const res = await fetch(item.url, {
          method: item.method,
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "Idempotency-Key": item.id },
          body: item.body ?? undefined,
        });

        if (res.ok) {
          sent++;
          continue;
        }

        if (res.status >= 500 || res.status === 401 || res.status === 429) {
          remaining.push({ ...item, attempts: item.attempts + 1 });
          stop = true;
          continue;
        }

        // A permanent rejection: keep it visible instead of silently dropping the user's request.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const list = failedList();
        failedWrite([
          ...list,
          { id: item.id, label: item.label, error: data.error || `Rejected (${res.status})`, failedAt: Date.now() },
        ]);
        failed++;
      } catch {
        // Offline again: keep everything from here on, in order.
        remaining.push(item);
        stop = true;
      }
    }

    // Preserve anything queued while the flush was running.
    const latest = outboxList();
    const sentIds = new Set(queue.map((q) => q.id));
    const newlyQueued = latest.filter((q) => !sentIds.has(q.id));
    outboxWrite([...remaining, ...newlyQueued]);

    return { sent, failed, pending: remaining.length + newlyQueued.length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
