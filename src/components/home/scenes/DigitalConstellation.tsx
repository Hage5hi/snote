// Digital Constellation v2 — three-band parallax starfield with periodic
// pulse waves that briefly light up nearby links. Canvas2D, lightweight.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;
const POINT_COUNT = 110;
const LINK_DIST = 130;
const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
const PULSE_INTERVAL_MS = 7000;
const PULSE_DURATION_MS = 2200;
const PULSE_SPEED = 0.35; // px/ms expansion

interface Pt {
  x: number; y: number;
  vx: number; vy: number;
  z: number;     // 0..1 (0=far, 1=near)
  band: 0 | 1 | 2;
  r: number;
}

interface Pulse {
  x: number; y: number;
  bornAt: number;
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
    let pulse: Pulse | null = null;
    let nextPulse = 0;
    const pts: Pt[] = [];
    const bgStars: { x: number; y: number; a: number }[] = [];

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Refresh background dust positions on resize.
      bgStars.length = 0;
      for (let i = 0; i < 60; i++) {
        bgStars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          a: 0.04 + Math.random() * 0.10,
        });
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Seed points across three discrete depth bands.
    for (let i = 0; i < POINT_COUNT; i++) {
      const band = (i % 3) as 0 | 1 | 2;
      const z = band === 0 ? 0.15 + Math.random() * 0.20
              : band === 1 ? 0.45 + Math.random() * 0.20
                           : 0.78 + Math.random() * 0.22;
      const speed = 0.12 + z * 0.35;
      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        z,
        band,
        r: 0.4 + z * 1.7,
      });
    }

    const start = performance.now();
    nextPulse = start + PULSE_INTERVAL_MS;

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Deep navy background.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#06091a");
      bg.addColorStop(1, "#0c1530");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Background static dust — adds depth without animating.
      for (const s of bgStars) {
        ctx.fillStyle = `rgba(180, 200, 240, ${s.a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, 1, 1);
      }

      // Update points.
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        else if (p.y > h + 20) p.y = -20;
      }

      // Maybe spawn a pulse from a random point.
      if (!pulse && now >= nextPulse) {
        const seed = pts[Math.floor(Math.random() * pts.length)];
        pulse = { x: seed.x, y: seed.y, bornAt: now };
        nextPulse = now + PULSE_INTERVAL_MS;
      }
      let pulseR = 0;
      let pulseAlpha = 0;
      if (pulse) {
        const age = now - pulse.bornAt;
        if (age > PULSE_DURATION_MS) {
          pulse = null;
        } else {
          pulseR = age * PULSE_SPEED;
          pulseAlpha = 1 - age / PULSE_DURATION_MS;
        }
      }

      // Links — only within same z-band or adjacent band, so clusters emerge.
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          if (Math.abs(a.band - b.band) > 1) continue;
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST_SQ) continue;
          const t = 1 - d2 / LINK_DIST_SQ;
          let alpha = t * 0.30 * (0.3 + 0.7 * Math.min(a.z, b.z));

          // Pulse boost — links within the wavefront ring brighten.
          if (pulse) {
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const pdx = mx - pulse.x;
            const pdy = my - pulse.y;
            const pd = Math.sqrt(pdx * pdx + pdy * pdy);
            const ringBand = Math.max(0, 1 - Math.abs(pd - pulseR) / 90);
            alpha += ringBand * pulseAlpha * 0.55;
          }

          if (alpha < 0.02) continue;
          ctx.strokeStyle = pulse
            ? `rgba(110, 168, 255, ${Math.min(alpha, 1).toFixed(3)})`
            : `rgba(148, 175, 220, ${Math.min(alpha, 1).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Pulse wavefront ring itself.
      if (pulse) {
        ctx.strokeStyle = `rgba(110, 168, 255, ${(pulseAlpha * 0.35).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, pulseR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Stars on top.
      for (const p of pts) {
        const alpha = 0.50 + p.z * 0.50;
        ctx.fillStyle = `rgba(219, 233, 255, ${alpha.toFixed(3)})`;
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
