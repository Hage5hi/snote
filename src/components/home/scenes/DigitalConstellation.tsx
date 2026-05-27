// Cung Hoàng Đạo (Zodiac Constellation) — multi-layered starfield Canvas2D scene.
//
// Four parallax layers (far stars, mid stars, dust, zodiacs) drift with the
// pointer to create depth. Each zodiac edge breathes on its own sine phase
// so the network feels alive; a slower periodic full-constellation pulse
// still fires every ~8s. Background stars twinkle independently.
//
// `lightweight: true` so it bypasses hardwareConcurrency<4.
// ThemeToggle pins next-themes to "dark" when this scene is active.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;
const PULSE_INTERVAL_MS = 7800;
const PULSE_DUR_MS = 1600;

const FAR_STARS = 220;
const MID_STARS = 110;
const DUST_COUNT = 30;

// Parallax magnitudes (px) per layer.
const PX_FAR = 3;
const PX_MID = 6;
const PX_DUST = 9;
const PX_ZODIAC = 14;

interface Constellation {
  name: string;
  pts: [number, number][];
  edges: [number, number][];
}

const ZODIAC: Constellation[] = [
  { name: "ARI", pts: [[-0.4,0.2],[-0.15,0.05],[0.1,-0.1],[0.3,-0.05],[0.4,0.15]],
    edges: [[0,1],[1,2],[2,3],[3,4]] },
  { name: "TAU", pts: [[-0.4,-0.3],[-0.2,0.0],[0.0,0.15],[0.2,0.0],[0.4,-0.3],[0.0,-0.25],[-0.1,-0.4]],
    edges: [[0,1],[1,2],[2,3],[3,4],[1,5],[3,5],[5,6]] },
  { name: "GEM", pts: [[-0.25,-0.35],[-0.25,-0.1],[-0.25,0.15],[-0.25,0.35],[0.25,-0.35],[0.25,-0.1],[0.25,0.15],[0.25,0.35]],
    edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[1,5],[2,6]] },
  { name: "CNC", pts: [[-0.3,-0.25],[0.0,-0.05],[0.3,-0.25],[0.0,0.25],[-0.15,0.35],[0.15,0.35]],
    edges: [[0,1],[2,1],[1,3],[3,4],[3,5]] },
  { name: "LEO", pts: [[-0.4,0.25],[-0.25,0.35],[-0.05,0.30],[0.05,0.10],[-0.05,-0.10],[0.20,-0.20],[0.40,-0.10]],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[3,5]] },
  { name: "VIR", pts: [[-0.45,-0.05],[-0.20,0.0],[-0.05,0.20],[0.10,-0.05],[0.30,0.10],[0.45,-0.15],[0.05,-0.25]],
    edges: [[0,1],[1,2],[1,3],[3,4],[4,5],[3,6]] },
  { name: "LIB", pts: [[-0.40,0.10],[0.0,-0.25],[0.40,0.10],[-0.25,0.30],[0.25,0.30]],
    edges: [[0,1],[1,2],[0,3],[2,4],[0,2]] },
  { name: "SCO", pts: [[-0.45,-0.20],[-0.30,-0.05],[-0.10,0.05],[0.10,0.05],[0.25,-0.05],[0.35,-0.20],[0.30,-0.35],[0.15,-0.40],[0.0,-0.30]],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]] },
  { name: "SGR", pts: [[-0.40,0.20],[-0.15,0.05],[0.0,-0.10],[0.20,-0.05],[0.40,0.10],[0.10,0.30],[-0.10,0.30]],
    edges: [[0,1],[1,2],[2,3],[3,4],[1,5],[3,6],[5,6]] },
  { name: "CAP", pts: [[-0.40,-0.10],[-0.15,0.10],[0.10,0.05],[0.30,-0.10],[0.40,-0.30],[0.15,-0.30]],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]] },
  { name: "AQR", pts: [[-0.45,0.15],[-0.20,-0.10],[0.0,0.10],[0.20,-0.10],[0.45,0.15],[-0.10,0.30],[0.30,0.30]],
    edges: [[0,1],[1,2],[2,3],[3,4],[1,5],[3,6]] },
  { name: "PSC", pts: [[-0.45,0.20],[-0.30,0.05],[-0.15,0.10],[0.0,0.0],[0.20,-0.10],[0.40,-0.20],[0.30,-0.05]],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,4]] },
];

interface Placed {
  con: Constellation;
  ax: number; ay: number;
  scale: number;
  rot: number;
}

interface Star { x: number; y: number; a: number; phase: number; }
interface Dust { x: number; y: number; a: number; vx: number; vy: number; }
interface PulseState { index: number; startedAt: number; }

function placeAll(): Placed[] {
  const grid: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      grid.push({ x: 0.10 + col * 0.27, y: 0.12 + row * 0.32 });
    }
  }
  return ZODIAC.map((con, i) => {
    const rng = (s: number) => (Math.sin(s * 13.37 + i * 1.91) * 0.5 + 0.5);
    const cell = grid[i];
    return {
      con,
      ax: cell.x + (rng(1) - 0.5) * 0.04,
      ay: cell.y + (rng(2) - 0.5) * 0.05,
      scale: 0.11 + rng(3) * 0.04,
      rot: (rng(4) - 0.5) * 0.35,
    };
  });
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

    const placed = placeAll();
    let targetMx = 0, targetMy = 0, mx = 0, my = 0;
    let farStars: Star[] = [];
    let midStars: Star[] = [];
    let dust: Dust[] = [];
    let nextPulse = performance.now() + PULSE_INTERVAL_MS;
    let pulse: PulseState | null = null;

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      farStars = [];
      for (let i = 0; i < FAR_STARS; i++) {
        farStars.push({
          x: Math.random() * w, y: Math.random() * h,
          a: 0.08 + Math.random() * 0.14,
          phase: Math.random() * Math.PI * 2,
        });
      }
      midStars = [];
      for (let i = 0; i < MID_STARS; i++) {
        midStars.push({
          x: Math.random() * w, y: Math.random() * h,
          a: 0.18 + Math.random() * 0.22,
          phase: Math.random() * Math.PI * 2,
        });
      }
      dust = [];
      for (let i = 0; i < DUST_COUNT; i++) {
        dust.push({
          x: Math.random() * w, y: Math.random() * h,
          a: 0.03 + Math.random() * 0.05,
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.08,
        });
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const onPointer = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      targetMx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      targetMy = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      mx += (targetMx - mx) * 0.08;
      my += (targetMy - my) * 0.08;

      // Deep space gradient.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#06091a");
      bg.addColorStop(1, "#0c1530");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const tSec = now * 0.001;

      // --- Layer 1: far stars (twinkle ±25%, faint parallax) ---
      const farOx = -PX_FAR * mx, farOy = -PX_FAR * my;
      for (const s of farStars) {
        const tw = 1 + 0.25 * Math.sin(tSec * 0.6 + s.phase);
        const a = Math.max(0, Math.min(1, s.a * tw));
        ctx.fillStyle = `rgba(219, 233, 255, ${a.toFixed(3)})`;
        ctx.fillRect(s.x + farOx, s.y + farOy, 1, 1);
      }

      // --- Layer 2: mid stars (twinkle ±35%, more parallax, slightly bigger) ---
      const midOx = -PX_MID * mx, midOy = -PX_MID * my;
      for (const s of midStars) {
        const tw = 1 + 0.35 * Math.sin(tSec * 0.9 + s.phase);
        const a = Math.max(0, Math.min(1, s.a * tw));
        ctx.fillStyle = `rgba(225, 236, 255, ${a.toFixed(3)})`;
        const sz = 1 + (Math.sin(s.phase) > 0.3 ? 0.5 : 0);
        ctx.fillRect(s.x + midOx, s.y + midOy, sz, sz);
      }

      // --- Layer 3: drifting dust ---
      const dustOx = -PX_DUST * mx, dustOy = -PX_DUST * my;
      for (const d of dust) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x += w; else if (d.x > w) d.x -= w;
        if (d.y < 0) d.y += h; else if (d.y > h) d.y -= h;
        ctx.fillStyle = `rgba(180, 200, 240, ${d.a.toFixed(3)})`;
        ctx.fillRect(d.x + dustOx, d.y + dustOy, 1, 1);
      }

      // Pulse scheduling (preserved).
      if (now >= nextPulse && !pulse) {
        pulse = { index: Math.floor(Math.random() * placed.length), startedAt: now };
        nextPulse = now + PULSE_INTERVAL_MS + Math.random() * 2000;
      }
      const pulseAge = pulse ? (now - pulse.startedAt) / PULSE_DUR_MS : 1;
      if (pulse && pulseAge >= 1) pulse = null;

      // --- Layer 4: zodiacs (full parallax + cursor tilt) ---
      const zOx = -PX_ZODIAC * mx, zOy = -PX_ZODIAC * my;
      const minDim = Math.min(w, h);

      placed.forEach((p, i) => {
        const cx = p.ax * w + zOx;
        const cy = p.ay * h + zOy;
        // Tilt the constellation slightly based on its position relative to centre.
        const tilt = (p.ax - 0.5) * my * 0.06 - (p.ay - 0.5) * mx * 0.06;
        const rot = p.rot + tilt;
        const scl = p.scale * minDim;
        const cos = Math.cos(rot), sin = Math.sin(rot);

        const screenPts = p.con.pts.map(([lx, ly]) => ({
          x: cx + (lx * cos - ly * sin) * scl,
          y: cy + (lx * sin + ly * cos) * scl,
        }));

        const isPulsing = pulse?.index === i;
        const pulseAmt = isPulsing
          ? Math.sin(pulseAge * Math.PI) * (1 - pulseAge * 0.4) * 0.8
          : 0;

        // Edges with per-edge breathing.
        for (let ei = 0; ei < p.con.edges.length; ei++) {
          const [a, b] = p.con.edges[ei];
          const phase = (i * 7 + ei) * 0.91;
          const glow = 0.5 + 0.5 * Math.sin(tSec * 1.1 + phase);
          const alpha = 0.18 + glow * 0.30 + pulseAmt * 0.35;
          const width = 0.55 + glow * 0.45 + pulseAmt * 0.9;
          ctx.lineWidth = width;
          ctx.strokeStyle = `rgba(170, 200, 240, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(screenPts[a].x, screenPts[a].y);
          ctx.lineTo(screenPts[b].x, screenPts[b].y);
          ctx.stroke();
        }

        // Stars at vertices — slow halo breathing.
        for (let vi = 0; vi < screenPts.length; vi++) {
          const sp = screenPts[vi];
          const phase = (i * 11 + vi) * 1.37;
          const breath = 0.5 + 0.5 * Math.sin(tSec * 0.6 + phase);
          const baseR = 1.7 + 0.5 * breath + pulseAmt * 1.4;
          const haloR = baseR * 4.5;
          const halo = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, haloR);
          halo.addColorStop(0, `rgba(219, 233, 255, ${(0.30 + breath * 0.18 + pulseAmt * 0.45).toFixed(3)})`);
          halo.addColorStop(1, "rgba(219, 233, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(235, 244, 255, ${(0.90 + pulseAmt * 0.10).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, baseR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Label.
        ctx.fillStyle = `rgba(170, 200, 240, ${(0.22 + pulseAmt * 0.4).toFixed(3)})`;
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textBaseline = "top";
        ctx.fillText(p.con.name, cx + scl * 0.35, cy + scl * 0.40);
      });

      if (onReadyRef.current) { onReadyRef.current(); onReadyRef.current = undefined; }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      try { host.removeChild(canvas); } catch { /* noop */ }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: "none" }}
    />
  );
}
