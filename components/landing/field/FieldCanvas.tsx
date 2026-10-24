"use client";

import { useEffect, useRef } from "react";
import { createField, type FieldHandle } from "./field-renderer";
import { readPalette } from "./palette";

interface FieldCanvasProps {
  isPaused: boolean;
  /** Called once the first frame is on screen, so the poster can step aside. */
  onReady: () => void;
}

const LOW_POWER_QUERY = "(pointer: coarse), (max-width: 767px)";

/** The live WebGL convergence field. Loaded with next/dynamic (ssr: false) after first paint. */
export default function FieldCanvas({ isPaused, onReady }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<FieldHandle | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const root = document.documentElement;

    let handle: FieldHandle;
    try {
      handle = createField({
        canvas,
        container,
        palette: readPalette(root),
        isLowPower: window.matchMedia(LOW_POWER_QUERY).matches,
        onFirstFrame: () => onReadyRef.current(),
      });
    } catch (error) {
      // Leave a breadcrumb for debugging without logging to the console.
      canvas.dataset.fieldError = error instanceof Error ? error.message : "unknown";
      // No WebGL: the static poster stays in place, which is a complete experience.
      return;
    }
    handleRef.current = handle;

    // Follow theme changes (toggle sets data-theme on <html>; the OS can flip too).
    const refresh = () => handle.setPalette(readPalette(root));
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", refresh);

    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", refresh);
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setPaused(isPaused);
  }, [isPaused]);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />;
}
