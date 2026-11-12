"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Photo size policy: every stored photo is between 50 KB and 100 KB (decimal kilobytes of JPEG data).
 *
 * The encoder walks down this list, best quality first, and keeps the first photo of at most TARGET_BYTES, which
 * lands most photos between 50 and 75 KB. The server refuses anything above 100 KB. Photos are stored as text in the
 * database (base64 is about a third larger than the JPEG), so staying near the middle of the range matters.
 */
const MIN_BYTES = 50_000;
const TARGET_BYTES = 75_000;
const MAX_BYTES = 100_000;
const STEPS: { side: number; quality: number }[] = [
  { side: 1024, quality: 0.85 },
  { side: 960, quality: 0.8 },
  { side: 800, quality: 0.75 },
  { side: 720, quality: 0.7 },
  { side: 640, quality: 0.7 },
  { side: 640, quality: 0.6 },
  { side: 560, quality: 0.55 },
  { side: 480, quality: 0.5 },
  { side: 480, quality: 0.4 },
  { side: 400, quality: 0.35 },
];

/** Real size in bytes of the JPEG inside a base64 data URL. */
function bytesOf(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

type Facing = "user" | "environment";

interface Props {
  title: string;
  onCapture: (photo: string) => void;
  onCancel: () => void;
}

/** Encodes the current video frame at the given size and quality as a JPEG data URL. */
function encodeFrame(video: HTMLVideoElement, side: number, quality: number): string | null {
  const scale = Math.min(1, side / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function errorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow camera access for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is being used by another app. Close it and try again.";
  }
  return "The camera could not be opened. Please try again.";
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.02 9.35h4.99m0 0V4.36m0 4.99l-3.18-3.18a8.25 8.25 0 00-13.8 3.7M7.98 14.65H2.99m0 0v4.99m0-4.99l3.18 3.18a8.25 8.25 0 0013.8-3.7" />
    </svg>
  );
}

/**
 * Live in-app camera for punching, shown full screen.
 *
 * 1. Live view with a front/back camera switch and a Capture button.
 * 2. Check screen: the photo that was taken, with Retake and Submit.
 *
 * There is deliberately NO file picker here, so a photo from the gallery cannot be submitted.
 */
export default function CameraCapture({ title, onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [mirror, setMirror] = useState(true);
  const [canFlip, setCanFlip] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [shot, setShot] = useState<{ preview: string; upload: string } | null>(null);
  const [sending, setSending] = useState(false);

  // Keep the page behind the camera from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, sending]);

  // (Re)start the camera whenever the chosen side changes or the person taps "Try again".
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");

    async function open(constraints: MediaStreamConstraints) {
      return navigator.mediaDevices.getUserMedia(constraints);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera. Use the app over HTTPS in a current browser.");
        return;
      }
      try {
        let stream: MediaStream;
        try {
          stream = await open({
            video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch (e) {
          const name = e instanceof DOMException ? e.name : "";
          // This device has no camera on the requested side: use whichever camera it has.
          if (name === "OverconstrainedError" || name === "NotFoundError") stream = await open({ video: true, audio: false });
          else throw e;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const settings = stream.getVideoTracks()[0]?.getSettings();
        // Mirror only the front camera, like a mirror; webcams that do not say which side they are count as front.
        setMirror(settings?.facingMode ? settings.facingMode === "user" : facing === "user");
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        // Device names are only available after the camera is allowed, so check for a second camera now.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
        } catch {
          if (!cancelled) setCanFlip(false);
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    }

    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, attempt]);

  const take = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setError("The camera is still starting. Try again in a moment.");
      return;
    }
    // First photo that fits the target. If that step fell below the 50 KB floor while the step before it was
    // still within the 100 KB ceiling, keep the earlier, larger one so the photo stays inside the range.
    let upload: string | null = null;
    let larger: string | null = null;
    for (const step of STEPS) {
      const data = encodeFrame(video, step.side, step.quality);
      if (!data) break;
      const size = bytesOf(data);
      if (size <= TARGET_BYTES) {
        upload = size < MIN_BYTES && larger ? larger : data;
        break;
      }
      if (size <= MAX_BYTES) larger = data;
      upload = data; // smallest so far, used only if no step reaches the target
    }
    if (!upload || bytesOf(upload) > MAX_BYTES) {
      setError("Could not make the photo small enough. Please retake it with better light, or closer to the camera.");
      return;
    }
    // The check screen shows exactly the photo that will be submitted.
    setShot({ preview: upload, upload });
  }, []);

  const submit = () => {
    if (!shot || sending) return;
    setSending(true);
    onCapture(shot.upload);
  };

  const reviewing = !!shot;

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title}>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          aria-label="Cancel"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-50"
        >
          <CloseIcon />
        </button>
        <div className="min-w-0 text-center">
          <h2 className="truncate text-sm font-bold">{reviewing ? "Check your photo" : title}</h2>
          <p className="text-xs text-white/70">{reviewing ? "Is your face clear and well lit?" : "Photos must be taken now"}</p>
        </div>
        {reviewing || !canFlip ? (
          <span className="h-11 w-11 shrink-0" aria-hidden="true" />
        ) : (
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            disabled={!ready && !error}
            aria-label={facing === "user" ? "Switch to back camera" : "Switch to front camera"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-50"
          >
            <FlipIcon />
          </button>
        )}
      </div>

      {/* Live view, or the photo that was taken */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${mirror ? "scale-x-[-1]" : ""} ${reviewing ? "hidden" : ""}`}
        />
        {reviewing && shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.preview} alt="The photo you just took" className="h-full w-full object-contain" />
        )}

        {!reviewing && ready && !error && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="aspect-[3/4] h-[62%] max-w-[80%] rounded-[50%] border-2 border-white/50" />
            </div>
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white/80 drop-shadow">
              {facing === "user" ? "Keep your face inside the oval" : "Back camera on"}
            </p>
          </>
        )}

        {!reviewing && !ready && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/80">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            Starting the camera…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            <p role="alert" className="max-w-sm text-sm font-medium leading-relaxed text-rose-200">{error}</p>
            <div className="flex gap-3">
              <button type="button" onClick={onCancel} className="rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/25">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setAttempt((a) => a + 1);
                }}
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5">
        {reviewing ? (
          <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShot(null)}
              disabled={sending}
              className="min-h-14 rounded-2xl bg-white/15 px-4 text-base font-bold transition hover:bg-white/25 disabled:opacity-50"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="min-h-14 rounded-2xl bg-emerald-500 px-4 text-base font-bold text-white transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {sending ? "Submitting…" : "Submit"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={take}
              disabled={!ready || !!error}
              aria-label="Capture photo"
              className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-4 border-white bg-transparent transition active:scale-95 disabled:opacity-40"
            >
              <span className="h-14 w-14 rounded-full bg-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
