"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { Button, Card, Modal } from "@/components/ui";

/** Size of the crop window on screen, in CSS pixels. The maths below depends on it, so it is fixed. */
const VIEW = 264;
/** Same limit as the server (src/lib/logo.ts): a logo is a small image, about 150 KB. */
const LOGO_LIMIT_CHARS = 200_000;
/** The saved logo is shrunk to the first of these sizes that fits the limit. */
const OUTPUT_SIZES = [320, 256, 192, 128];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_ZOOM = 4;

interface Crop {
  /** Displayed pixels per image pixel. */
  scale: number;
  /** Position of the image's top-left corner inside the crop window. Always covers the window. */
  left: number;
  top: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Keeps the picture covering the whole crop window, so the saved logo never has empty edges. */
function fitCrop(c: Crop, w: number, h: number): Crop {
  return {
    scale: c.scale,
    left: clamp(c.left, VIEW - w * c.scale, 0),
    top: clamp(c.top, VIEW - h * c.scale, 0),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a picture this browser can read."));
    img.src = url;
  });
}

/** Renders the crop window as a square logo and encodes it, shrinking until it fits the size limit. */
function encodeLogo(img: HTMLImageElement, crop: Crop, round: boolean): string {
  const draw = (size: number, whiteBackground: boolean): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot prepare the logo.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (whiteBackground) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
    }
    if (round) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    // The part of the picture that sits inside the crop window.
    const sx = -crop.left / crop.scale;
    const sy = -crop.top / crop.scale;
    const side = VIEW / crop.scale;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas;
  };

  for (const size of OUTPUT_SIZES) {
    // PNG keeps a transparent background (and round corners) crisp.
    const png = draw(size, false).toDataURL("image/png");
    if (png.length <= LOGO_LIMIT_CHARS) return png;
    // JPEG has no transparency, so it gets a white background.
    for (const quality of [0.9, 0.78]) {
      const jpeg = draw(size, true).toDataURL("image/jpeg", quality);
      if (jpeg.length <= LOGO_LIMIT_CHARS) return jpeg;
    }
  }
  throw new Error("This picture is too detailed to fit as a logo. Try a simpler picture, or crop a smaller area.");
}

/**
 * Company admin: upload any picture, crop it (drag to position, zoom, square or round frame), then save.
 * The saved logo appears across the app and on salary slips. Employees see it read-only elsewhere.
 */
export default function LogoEditor({ version }: { version: number | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const [src, setSrc] = useState<string | null>(null); // object URL of the picture being cropped
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop>({ scale: 1, left: 0, top: 0 });
  const [round, setRound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewFailedFor, setPreviewFailedFor] = useState<number | null>(null);

  // Free the object URL when the picture changes or the editor closes.
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const minScale = natural ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1;
  const zoom = natural ? crop.scale / minScale : 1;

  const close = () => {
    setSrc(null);
    setNatural(null);
    imgRef.current = null;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setMessage("");
    if (!file.type.startsWith("image/")) {
      setError("Choose a picture file (PNG, JPEG, WebP or similar).");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That picture is larger than 15 MB. Choose a smaller one.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const s = Math.max(VIEW / w, VIEW / h);
      imgRef.current = img;
      setNatural({ w, h });
      setCrop({ scale: s, left: (VIEW - w * s) / 2, top: (VIEW - h * s) / 2 });
      setRound(false);
      setSrc(url);
    } catch (e) {
      URL.revokeObjectURL(url);
      setError(e instanceof Error ? e.message : "Could not open that picture.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setZoom = (z: number) => {
    if (!natural) return;
    const next = minScale * z;
    const c = VIEW / 2;
    const ratio = next / crop.scale;
    setCrop(
      fitCrop(
        { scale: next, left: c - (c - crop.left) * ratio, top: c - (c - crop.top) * ratio },
        natural.w,
        natural.h
      )
    );
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, left: crop.left, top: crop.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !natural) return;
    setCrop(
      fitCrop(
        { scale: crop.scale, left: d.left + (e.clientX - d.x), top: d.top + (e.clientY - d.y) },
        natural.w,
        natural.h
      )
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = async () => {
    if (!imgRef.current || !natural) return;
    setSaving(true);
    setError("");
    try {
      const logoDataUrl = encodeLogo(imgRef.current, crop, round);
      await api<{ ok: boolean; version: number }>("/api/company/logo", {
        method: "POST",
        body: JSON.stringify({ logoDataUrl }),
      });
      close();
      setMessage("Logo saved. It now shows across the app and on salary slips.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the logo.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the company logo? The app will show the default icon instead.")) return;
    setRemoving(true);
    setError("");
    setMessage("");
    try {
      await api("/api/company/logo", { method: "DELETE" });
      setMessage("Logo removed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the logo.");
    } finally {
      setRemoving(false);
    }
  };

  const hasLogo = version !== null && previewFailedFor !== version;

  return (
    <>
      <Card>
        <h3 className="mb-1 font-bold text-slate-900">Company logo</h3>
        <p className="mb-3 text-xs text-slate-500">
          Shown in the app header for everyone in your company, and at the top of salary slips. Upload any picture, then crop it.
        </p>

        <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/company/logo?v=${version}`}
                alt="Company logo"
                className="h-full w-full object-contain"
                onError={() => setPreviewFailedFor(version)}
              />
            ) : (
              <span className="text-[10px] font-semibold text-slate-400">No logo</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-indigo-700 ring-1 ring-slate-300 hover:bg-slate-50">
              {hasLogo ? "Change logo" : "Upload logo"}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {hasLogo && (
              <button
                type="button"
                onClick={remove}
                disabled={removing}
                className="rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        {message && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}
      </Card>

      <Modal open={!!src} onClose={close} title="Crop your logo">
        {src && natural && (
          <div>
            <div
              className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-slate-900"
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{ left: crop.left, top: crop.top, width: natural.w * crop.scale, height: natural.h * crop.scale }}
              />
              {round ? (
                <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(15,23,42,0.6)] ring-2 ring-white" />
              ) : (
                <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white" />
              )}
            </div>

            <div className="mt-4 flex justify-center gap-2" role="group" aria-label="Crop shape">
              {[
                { value: false, label: "Square" },
                { value: true, label: "Round" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={round === o.value}
                  onClick={() => setRound(o.value)}
                  className={
                    round === o.value
                      ? "rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
                      : "rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block">
              <span className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
                <span>Zoom</span>
                <span className="text-slate-400">{Math.round(zoom * 100)}%</span>
              </span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </label>

            <p className="mt-3 text-center text-xs text-slate-500">
              Drag the picture to position it. Any picture size works; it is shrunk to a small logo automatically.
            </p>

            {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                Save logo
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
