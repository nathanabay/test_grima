"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ErrorBox, Pill } from "@/components/ui";

/**
 * Camera barcode scanning (§17).
 *
 * Uses the browser's native BarcodeDetector where it exists (Chrome and Android
 * WebView, which is what warehouse handsets run). Elsewhere — Safari, Firefox —
 * the component says so plainly and falls back to keyboard entry, which is also
 * how a wedge scanner behaves. It never pretends to scan when it cannot.
 */

const FORMATS = [
  "data_matrix",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
];

export interface ScanResolution {
  parsed: {
    format: string;
    isGs1: boolean;
    gtin?: string;
    batchNumber?: string;
    serialNumber?: string;
    expiryDate?: string;
    raw: string;
    errors: string[];
  };
  product: any | null;
  batch: any | null;
  serial: any | null;
  warnings: string[];
}

export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function Scanner({
  onResolved,
  autoStart = false,
  label = "Scan",
}: {
  onResolved: (result: ScanResolution) => void;
  autoStart?: boolean;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [active, setActive] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => setSupported(cameraScanSupported()), []);

  const resolve = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setBusy(true);
      setError(null);
      try {
        onResolved(
          await api<ScanResolution>("/scan", {
            method: "POST",
            body: { code },
          }),
        );
      } catch (e: any) {
        setError(e.message ?? "Could not resolve the scanned code");
      } finally {
        setBusy(false);
      }
    },
    [onResolved],
  );

  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!cameraScanSupported()) {
      setError(
        "This browser has no barcode detector. Use a USB/Bluetooth scanner or type the code below.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera on a handset; falls back to whatever exists on a laptop.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      setActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const Detector = (window as any).BarcodeDetector;
      const supportedFormats: string[] =
        await Detector.getSupportedFormats().catch(() => FORMATS);
      const detector = new Detector({
        formats: FORMATS.filter((f) => supportedFormats.includes(f)),
      });

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length) {
            const value: string = codes[0].rawValue;
            const now = Date.now();
            // The same pack stays in frame for many frames; debounce so one
            // physical scan produces one lookup.
            if (
              value !== lastCodeRef.current.code ||
              now - lastCodeRef.current.at > 2500
            ) {
              lastCodeRef.current = { code: value, at: now };
              if (navigator.vibrate) navigator.vibrate(40);
              await resolve(value);
            }
          }
        } catch {
          // A dropped frame is normal; keep scanning.
        }
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera permission was refused. Allow it in your browser settings, or type the code below."
          : `Could not start the camera: ${e?.message ?? e}`,
      );
      stop();
    }
  }, [resolve, stop]);

  // Release the camera when the component goes away.
  useEffect(() => {
    if (autoStart) void start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!active ? (
          <button
            type="button"
            className="btn-primary"
            onClick={start}
            disabled={busy}
          >
            {label} with camera
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={stop}>
            Stop camera
          </button>
        )}
        {supported ? (
          <Pill tone="ok">Camera scanning available</Pill>
        ) : (
          <Pill tone="warn">No camera detector in this browser</Pill>
        )}
      </div>

      {active && (
        <div className="relative overflow-hidden rounded-lg border border-surface-border bg-black">
          <video
            ref={videoRef}
            className="w-full max-h-[46vh] object-contain"
            muted
            playsInline
          />
          {/* Aiming guide: a pack held inside this box reads reliably. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-64 rounded-lg border-2 border-brand/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/90">
            Hold the DataMatrix or barcode inside the frame
          </div>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void resolve(manual);
          setManual("");
        }}
      >
        <input
          className="input flex-1"
          placeholder="Or scan with a handheld reader / type the code"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          // A wedge scanner types the code then sends Enter. Handle the key
          // explicitly rather than relying on implicit form submission, which
          // some embedded browsers and scanner drivers do not trigger.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const code = manual;
              setManual("");
              void resolve(code);
            }
          }}
          autoFocus={!active}
        />
        <button className="btn-ghost" disabled={busy || !manual.trim()}>
          {busy ? "Looking up..." : "Look up"}
        </button>
      </form>

      {error && <ErrorBox message={error} />}
    </div>
  );
}
