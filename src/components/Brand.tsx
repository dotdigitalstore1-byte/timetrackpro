import { cn } from "@/lib/utils";

/**
 * The Dotinout (DIO) mark: a ring with a gap at the top, where the punch "dot" sits, and a centre dot.
 * Designed on a 48-unit grid. The same geometry is used for the app icons in /public/icons.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dio-mark-gradient" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#dio-mark-gradient)" />
      <g transform="translate(5.28 5.28) scale(0.78)">
        <path d="M30 13.61 A12 12 0 1 1 18 13.61" fill="none" stroke="#fff" strokeWidth="3.4" />
        <circle cx="24" cy="24" r="4.6" fill="#fff" />
        <circle cx="24" cy="12" r="2.6" fill="#fff" />
      </g>
    </svg>
  );
}

const SIZES = {
  sm: { mark: "h-7 w-7", text: "text-base", gap: "gap-2" },
  md: { mark: "h-9 w-9", text: "text-lg", gap: "gap-2.5" },
  lg: { mark: "h-14 w-14", text: "text-3xl", gap: "gap-3" },
} as const;

/** Mark plus the Dotinout wordmark. "in" and "out" are coloured to carry the punch idea. */
export function BrandLockup({
  size = "md",
  tone = "dark",
  className,
}: {
  size?: keyof typeof SIZES;
  /** "dark" for light backgrounds, "light" for dark or gradient backgrounds. */
  tone?: "dark" | "light";
  className?: string;
}) {
  const s = SIZES[size];
  const light = tone === "light";
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <BrandMark className={cn("shrink-0 rounded-xl", s.mark)} />
      <span className={cn("font-extrabold leading-none tracking-tight", s.text, light ? "text-white" : "text-slate-900")}>
        Dot
        <span className={light ? "text-indigo-200" : "text-indigo-600"}>in</span>
        <span className={light ? "text-violet-200" : "text-violet-600"}>out</span>
      </span>
    </span>
  );
}
