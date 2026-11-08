"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PickableEmployee {
  id: string;
  name: string;
  code?: string | null;
}

/** Matches a name, a full employee code (EMP-0012), or just the number (12). Case-insensitive. */
export function matchesEmployee(e: PickableEmployee, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  if (e.name.toLowerCase().includes(term)) return true;
  const code = (e.code ?? "").toLowerCase();
  if (code.includes(term) || code.replace(/-/g, "").includes(term.replace(/[\s-]/g, ""))) return true;
  // a plain number matches the code's number, ignoring leading zeros: "12" finds EMP-0012
  if (/^\d+$/.test(term)) {
    const digits = code.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (digits && digits.includes(term.replace(/^0+(?=\d)/, ""))) return true;
  }
  return false;
}

/**
 * A searchable employee selector. Type a name or an employee code to find someone quickly, which
 * matters when two people share a name. `allLabel` adds an "all employees" choice (value "").
 */
export default function EmployeePicker({
  label,
  value,
  onChange,
  items,
  allLabel,
  placeholder = "Select employee…",
}: {
  label?: string;
  value: string;
  onChange: (id: string) => void;
  items: PickableEmployee[];
  allLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === value);
  const matches = useMemo(() => items.filter((i) => matchesEmployee(i, query)), [items, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={root} className="relative w-full">
      {label && <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-left text-sm outline-none transition focus:border-indigo-500"
      >
        <span className="min-w-0 truncate">
          {selected ? (
            <>
              <span className="font-medium text-slate-800">{selected.name}</span>
              {selected.code && <span className="ml-2 text-xs text-slate-400">{selected.code}</span>}
            </>
          ) : (
            <span className="text-slate-400">{allLabel ?? placeholder}</span>
          )}
        </span>
        <svg className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or employee code…"
              className="w-full rounded-lg bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {allLabel !== undefined && (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50 ${!value ? "font-semibold text-indigo-700" : "text-slate-600"}`}
                >
                  {allLabel}
                  {!value && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            )}
            {matches.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => pick(i.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-50 ${value === i.id ? "bg-indigo-50" : ""}`}
                >
                  <span className="min-w-0 truncate font-medium text-slate-800">{i.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {i.code && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{i.code}</span>}
                    {value === i.id && <span className="text-indigo-600" aria-hidden="true">✓</span>}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No one matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
