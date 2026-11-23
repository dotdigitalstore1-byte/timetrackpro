"use client";

import { useEffect, useState, type ReactNode } from "react";

// "Dotinout" letters: index 1, 2, 4, 6, 7 are the o, t, n, u, t that fade away. D, i and o remain and become D, I, O.
const LETTERS = ["D", "o", "t", "i", "n", "o", "u", "t"];
const FADE_OUT = new Set([1, 2, 4, 6, 7]);
// Timeline (ms): full word, fade out, merge into DIO, leave, unmount.
const MS = { fade: 700, merge: 1500, leave: 2300, done: 2800 };

/**
 * Launch animation for the mobile apps only. The server renders the overlay on the first paint for the native app,
 * so the screen is never blank while the app loads. On the web this renders the children unchanged.
 */
export default function NativeSplash({ native, children }: { native: boolean; children: ReactNode }) {
  const [step, setStep] = useState(native ? 0 : 4);

  useEffect(() => {
    if (!native) return;
    const timers = [
      window.setTimeout(() => setStep(1), MS.fade),
      window.setTimeout(() => setStep(2), MS.merge),
      window.setTimeout(() => setStep(3), MS.leave),
      window.setTimeout(() => setStep(4), MS.done),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [native]);

  return (
    <>
      {step < 4 && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-700"
          style={{ opacity: step === 3 ? 0 : 1, transition: "opacity 480ms ease" }}
        >
          <div className="flex text-5xl font-black tracking-tight text-white sm:text-6xl">
            {LETTERS.map((letter, i) => {
              const gone = step >= 1 && FADE_OUT.has(i);
              const merged = step >= 2 && !gone;
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    overflow: "hidden",
                    maxWidth: gone ? "0em" : "1.4em",
                    opacity: gone ? 0 : 1,
                    transform: gone ? "scale(0.6) translateY(6px)" : "none",
                    textTransform: merged ? "uppercase" : "none",
                    transition: "opacity 420ms ease, transform 420ms ease, max-width 520ms ease, text-transform 200ms ease",
                  }}
                >
                  {letter}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
