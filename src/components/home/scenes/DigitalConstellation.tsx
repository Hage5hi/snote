// Cung Hoàng Đạo (Zodiac Map) — autonomous starfield Canvas2D scene.
//
// No pointer interaction. Background stars twinkle on their own sine phases;
// each of the 12 zodiacs breathes asynchronously (~35s period); the whole
// sky drifts horizontally (sidereal drift) with a tiny vertical bob so the
// celestial sphere feels alive without any user input.
//
// `lightweight: true` so it bypasses hardwareConcurrency<4.
// ThemeToggle pins next-themes to "dark" when this scene is active.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;

const FAR_STARS = 220;
const MID_STARS = 110;
const DUST_COUNT = 30;

// Sidereal drift: ~4 px/sec at base layer ≈ one screen-width per ~6 min.
// Each layer scales this to fake parallax depth without mouse input.
const DRIFT_PX_PER_SEC = 4;
const DRIFT_K_FAR = 0.4;
const DRIFT_K_MID = 0.55;
const DRIFT_K_DUST = 0.75;
const DRIFT_K_ZODIAC = 1.0;

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
    let farStars: Star[] = [];
    let midStars: Star[] = [];
    let dust: Dust[] = [];

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

    // Seamless horizontal wrap helper.
    const wrapX = (x: number) => ((x % w) + w) % w;

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Deep space gradient.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#06091a");
      bg.addColorStop(1, "#0c1530");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const tSec = now * 0.001;

      // Autonomous sidereal drift — same for every layer scaled by depth.
      const driftBase = tSec * DRIFT_PX_PER_SEC;
      const driftY = Math.sin(tSec * 0.04) * 6;

      // --- Layer 1: far stars (twinkle ±25%, slowest drift) ---
      {
        const dx = driftBase * DRIFT_K_FAR;
        for (const s of farStars) {
          const tw = 1 + 0.25 * Math.sin(tSec * 0.6 + s.phase);
          const a = Math.max(0, Math.min(1, s.a * tw));
          ctx.fillStyle = `rgba(219, 233, 255, ${a.toFixed(3)})`;
          ctx.fillRect(wrapX(s.x + dx), s.y + driftY, 1, 1);
        }
      }

      // --- Layer 2: mid stars (twinkle ±35%, slightly bigger) ---
      {
        const dx = driftBase * DRIFT_K_MID;
        for (const s of midStars) {
          const tw = 1 + 0.35 * Math.sin(tSec * 0.9 + s.phase);
          const a = Math.max(0, Math.min(1, s.a * tw));
          ctx.fillStyle = `rgba(225, 236, 255, ${a.toFixed(3)})`;
          const sz = 1 + (Math.sin(s.phase) > 0.3 ? 0.5 : 0);
          ctx.fillRect(wrapX(s.x + dx), s.y + driftY, sz, sz);
        }
      }

      // --- Layer 3: drifting dust ---
      {
        const dx = driftBase * DRIFT_K_DUST;
        for (const d of dust) {
          d.x += d.vx; d.y += d.vy;
          if (d.x < 0) d.x += w; else if (d.x > w) d.x -= w;
          if (d.y < 0) d.y += h; else if (d.y > h) d.y -= h;
          ctx.fillStyle = `rgba(180, 200, 240, ${d.a.toFixed(3)})`;
          ctx.fillRect(wrapX(d.x + dx), d.y + driftY, 1, 1);
        }
      }

      // --- Layer 4: zodiacs with async breathing + drift ---
      const zDrift = driftBase * DRIFT_K_ZODIAC;
      const minDim = Math.min(w, h);

      const drawConstellation = (p: Placed, i: number, cxBase: number) => {
        const cx = cxBase;
        const cy = p.ay * h + driftY;
        const scl = p.scale * minDim;
        const cos = Math.cos(p.rot), sin = Math.sin(p.rot);

        const screenPts = p.con.pts.map(([lx, ly]) => ({
          x: cx + (lx * cos - ly * sin) * scl,
          y: cy + (lx * sin + ly * cos) * scl,
        }));

        // Slow per-constellation breath: ~35 s period, async per zodiac.
        const conBreath = 0.5 + 0.5 * Math.sin(tSec * 0.18 + i * 1.7);
        const conGlow = 0.55 + 0.45 * conBreath;

        // Edges with per-edge micro-twinkle layered under the slow breath.
        for (let ei = 0; ei < p.con.edges.length; ei++) {
          const [a, b] = p.con.edges[ei];
          const phase = (i * 7 + ei) * 0.91;
          const tw = 0.5 + 0.5 * Math.sin(tSec * 1.1 + phase);
          const alpha = (0.18 + tw * 0.30) * conGlow;
          const width = (0.55 + tw * 0.45) * (0.7 + 0.3 * conBreath);
          ctx.lineWidth = width;
          ctx.strokeStyle = `rgba(170, 200, 240, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(screenPts[a].x, screenPts[a].y);
          ctx.lineTo(screenPts[b].x, screenPts[b].y);
          ctx.stroke();
        }

        // Stars at vertices — halo modulated by constellation breath.
        for (let vi = 0; vi < screenPts.length; vi++) {
          const sp = screenPts[vi];
          const phase = (i * 11 + vi) * 1.37;
          const breath = 0.5 + 0.5 * Math.sin(tSec * 0.6 + phase);
          const baseR = 1.7 + 0.5 * breath;
          const haloR = baseR * 4.5;
          const haloA = (0.30 + breath * 0.18) * conGlow;
          const halo = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, haloR);
          halo.addColorStop(0, `rgba(219, 233, 255, ${haloA.toFixed(3)})`);
          halo.addColorStop(1, "rgba(219, 233, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(235, 244, 255, ${(0.78 + conBreath * 0.22).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, baseR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Label.
        ctx.fillStyle = `rgba(170, 200, 240, ${(0.18 + conBreath * 0.18).toFixed(3)})`;
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textBaseline = "top";
        ctx.fillText(p.con.name, cx + scl * 0.35, cy + scl * 0.40);
      };

      placed.forEach((p, i) => {
        const rawCx = p.ax * w + zDrift;
        const cx = wrapX(rawCx);
        const halfSpan = p.scale * minDim * 0.6; // ~ bounding radius
        drawConstellation(p, i, cx);
        // Draw a wrapped copy when the constellation straddles the seam,
        // so it eases off one edge while easing onto the other.
        if (cx < halfSpan) {
          drawConstellation(p, i, cx + w);
        } else if (cx > w - halfSpan) {
          drawConstellation(p, i, cx - w);
        }
      });

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
      style={{ pointerEvents: "none" }}
    />
  );
}
