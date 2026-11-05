"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600",
        className
      )}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  disabled,
  loading,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  const sizes = {
    sm: "min-h-9 px-3 py-2 text-xs",
    md: "min-h-11 px-4 py-2.5 text-sm",
    lg: "min-h-12 px-6 py-3 text-base",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Spinner className="h-4 w-4 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-200/70", className)} />;
}

export function StatCard({
  label,
  value,
  sub,
  tone = "indigo",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "indigo" | "emerald" | "rose" | "amber" | "sky" | "slate";
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <Card className="p-4">
      <div className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold", tones[tone])}>
        {sub ?? ""}
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
    </Card>
  );
}

export function Input({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  min,
  max,
  step,
  className,
  disabled,
}: {
  label?: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>}
      <input
        type={type}
        disabled={disabled}
        value={value}
        required={required}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      />
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "green" | "red" | "amber" | "indigo" | "slate" | "sky" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1", tones[tone])}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Touch-friendly multi-select shown as tappable chips (works better than <select multiple> on phones).
 * `emptyHint` is rendered when there are no options to pick from yet.
 */
export function ChipSelect({
  label,
  options,
  values,
  onChange,
  emptyHint,
  required,
}: {
  label: string;
  options: { value: string; label: string; muted?: boolean }[];
  values: string[];
  onChange: (values: string[]) => void;
  emptyHint?: ReactNode;
  required?: boolean;
}) {
  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
        {values.length > 0 && <span className="ml-1 font-medium text-slate-400">({values.length} selected)</span>}
      </span>
      {options.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          {emptyHint ?? "Nothing to choose from yet."}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
          {options.map((o) => {
            const on = values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.value)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                  on
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  o.muted && !on && "opacity-60"
                )}
              >
                {on && (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
          Try again
        </button>
      )}
    </div>
  );
}

export function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>}
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}
