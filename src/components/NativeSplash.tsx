"use client";

import { useEffect, useState, type ReactNode } from "react";

// "Dotinout" letters: index 1, 2, 4, 6, 7 are the o, t, n, u, t that fade away. D, i and o remain and settle into
// "Dio". Case never changes: only the D is capital.
const LETTERS = ["D", "o", "t", "i", "n", "o", "u", "t"];
const FADE_OUT = new Set([1, 2, 4, 6, 7]);
// Timeline (ms): full word, fade out, settle into Dio, leave, unmount.
const MS = { fade: 700, merge: 1500, leave: 2300, done: 2800 };
// One easing curve for every movement, so the letters glide together instead of snapping.
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

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
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{
            backgroundColor: "#4f46e5", // identical to the native splash colour, so there is no flicker
            opacity: step === 3 ? 0 : 1,
            transition: `opacity 520ms ${EASE}`,
            willChange: "opacity",
          }}
        >
          <div className="flex text-5xl font-black tracking-tight text-white sm:text-6xl">
            {LETTERS.map((letter, i) => {
              const gone = step >= 1 && FADE_OUT.has(i);
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    overflow: "hidden",
                    maxWidth: gone ? "0em" : "1.4em",
                    opacity: gone ? 0 : 1,
                    transform: gone ? "scale(0.6) translateY(6px)" : "none",
                    transition: `opacity 460ms ${EASE}, transform 460ms ${EASE}, max-width 560ms ${EASE}`,
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
