"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/**
 * Heavy compression for storage: photos are aimed at about 30 KB. The first setting is the best quality; the
 * encoder only steps down (smaller side, lower quality) while the photo is still too big. 280 px is still
 * enough to see the face clearly for attendance checks.
 */
const TARGET_CHARS = 40_000; // base64 characters, roughly 30 KB of JPEG
const STEPS: { side: number; quality: number }[] = [
  { side: 400, quality: 0.5 },
  { side: 360, quality: 0.45 },
  { side: 320, quality: 0.4 },
  { side: 320, quality: 0.3 },
  { side: 280, quality: 0.3 },
  { side: 240, quality: 0.25 },
];

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

/**
 * Live in-app camera for punching. There is deliberately NO file picker here,
 * so a photo from the gallery cannot be submitted.
 */
export default function CameraCapture({ title, onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera. Use the app over HTTPS in a current browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setError("Camera access was blocked. Allow camera access for this site, then try again.");
      }
    }

    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const take = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setError("The camera is still starting. Try again in a moment.");
      return;
    }
    let chosen: string | null = null;
    for (const step of STEPS) {
      const data = encodeFrame(video, step.side, step.quality);
      if (!data) break;
      chosen = data;
      if (data.length <= TARGET_CHARS) break;
    }
    if (!chosen) {
      setError("Could not process the photo. Please try again.");
      return;
    }
    onCapture(chosen);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <h3 className="font-bold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">Face the camera and tap Capture. Photos must be taken now.</p>

        <div className="mt-3 aspect-[4/3] overflow-hidden rounded-xl bg-slate-900">
          {/* Mirrored for a natural selfie preview; the captured frame itself is not mirrored. */}
          <video ref={videoRef} playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
        </div>

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="success" onClick={take} disabled={!ready || !!error}>Capture</Button>
        </div>
      </div>
    </div>
  );
}
