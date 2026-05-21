// Terminal Boot — phosphor-green matrix rain on a near-black CRT.
//
// Canvas2D, capped at 20fps (rain feels right slower) and `lightweight: true`
// so it runs on low-end devices. Pure aesthetic — no decoded characters carry
// meaning, font lives inside the canvas only so no global font override.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 20;
const FONT_PX = 14;
const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789<>/*+-=#$@";

export default function TerminalBoot({ paused, onReady }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) { try { host.removeChild(canvas); } catch { /* noop */ } return; }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 1, h = 1;
    let cols = 0;
    let drops: number[] = [];
    let rafId = 0, lastFrame = 0;

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / FONT_PX);
      drops = new Array(cols).fill(0).map(() => Math.random() * (h / FONT_PX));
      // Prime the background.
      ctx.fillStyle = "#020402";
      ctx.fillRect(0, 0, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Translucent black overlay creates the phosphor trail.
      ctx.fillStyle = "rgba(2, 4, 2, 0.16)";
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${FONT_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
        const x = i * FONT_PX;
        const y = drops[i] * FONT_PX;
        // Lead glyph — bright white-green.
        ctx.fillStyle = "rgba(190, 255, 200, 0.95)";
        ctx.fillText(ch, x, y);
        // Trail glyph one step up — classic phosphor green.
        ctx.fillStyle = "rgba(0, 255, 102, 0.55)";
        ctx.fillText(ch, x, y - FONT_PX);

        // Reset stream randomly once it falls past the bottom.
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }

      if (onReadyRef.current) { onReadyRef.current(); onReadyRef.current = undefined; }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      try { host.removeChild(canvas); } catch { /* noop */ }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}
