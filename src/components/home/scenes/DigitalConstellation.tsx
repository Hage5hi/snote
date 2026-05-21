// Digital Constellation — lightweight Canvas2D scene.
//
// ~80 drifting "stars" (Poisson-ish distributed) connected by faint links
// when within proximity. Parallax-like depth via per-point z and alpha.
// Tagged `lightweight: true` in the registry so it bypasses the
// hardwareConcurrency<4 guard.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;
const POINT_COUNT = 80;
const LINK_DIST = 130;        // px in CSS space
const LINK_DIST_SQ = LINK_DIST * LINK_DIST;

interface Pt {
  x: number; y: number;       // CSS px
  vx: number; vy: number;
  z: number;                  // 0..1 (0 = far, 1 = near)
  r: number;                  // radius
}

export default function DigitalConstellation({ paused, onReady }: SceneProps) {
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
    if (!ctx) {
      try { host.removeChild(canvas); } catch { /* noop */ }
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 1, h = 1;
    let rafId = 0, lastFrame = 0;
    const pts: Pt[] = [];

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Seed points.
    for (let i = 0; i < POINT_COUNT; i++) {
      const z = Math.random();
      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * (0.15 + z * 0.25),
        vy: (Math.random() - 0.5) * (0.15 + z * 0.25),
        z,
        r: 0.4 + z * 1.6,
      });
    }

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Background — deep navy w/ subtle vertical gradient.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0b1424");
      bg.addColorStop(1, "#0a0f1c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Update + draw links first (under points).
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        else if (p.y > h + 20) p.y = -20;
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST_SQ) continue;
          const t = 1 - d2 / LINK_DIST_SQ;
          const alpha = t * 0.28 * (0.3 + 0.7 * Math.min(a.z, b.z));
          ctx.strokeStyle = `rgba(148, 175, 220, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Stars.
      for (const p of pts) {
        const alpha = 0.45 + p.z * 0.55;
        ctx.fillStyle = `rgba(220, 232, 248, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
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
