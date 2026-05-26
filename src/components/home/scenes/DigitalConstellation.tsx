// Cung Hoàng Đạo (Zodiac Constellation) — lightweight Canvas2D scene.
//
// 12 stylized zodiac constellations scattered across the canvas. Each
// constellation is a hand-drawn skeleton of stars (5–9 points) connected by
// faint links. Three parallax z-bands track the pointer for subtle depth,
// and every ~8s a random constellation pulses to life. Pure aesthetic — the
// star coordinates are not astronomically accurate; they're shape mnemonics
// (Leo's sickle, Scorpio's tail, the Big-Dipper-shaped Ursa Major-ish Aries).
//
// `lightweight: true` so it bypasses the hardwareConcurrency<4 guard.
// ThemeToggle pins next-themes to "dark" when this scene is active.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;
const PULSE_INTERVAL_MS = 7800;
const PULSE_DUR_MS = 1600;
const STARFIELD_COUNT = 70;

// Constellation = local-space points (0..1 with origin in centre, ~−0.5..0.5)
// + edge index pairs (Hamiltonian-style traversal, not minimum-spanning).
// Coordinates were sketched by hand to read instantly as the named figure.
interface Constellation {
  name: string;
  pts: [number, number][];
  edges: [number, number][];
}

const ZODIAC: Constellation[] = [
  {
    name: "ARI", // Aries — ram horn curve
    pts: [[-0.4, 0.2], [-0.15, 0.05], [0.1, -0.1], [0.3, -0.05], [0.4, 0.15]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    name: "TAU", // Taurus — bull head with V horns
    pts: [[-0.4, -0.3], [-0.2, 0.0], [0.0, 0.15], [0.2, 0.0], [0.4, -0.3], [0.0, -0.25], [-0.1, -0.4]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [3, 5], [5, 6]],
  },
  {
    name: "GEM", // Gemini — twin parallel lines
    pts: [[-0.25, -0.35], [-0.25, -0.1], [-0.25, 0.15], [-0.25, 0.35], [0.25, -0.35], [0.25, -0.1], [0.25, 0.15], [0.25, 0.35]],
    edges: [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [1, 5], [2, 6]],
  },
  {
    name: "CNC", // Cancer — crab Y
    pts: [[-0.3, -0.25], [0.0, -0.05], [0.3, -0.25], [0.0, 0.25], [-0.15, 0.35], [0.15, 0.35]],
    edges: [[0, 1], [2, 1], [1, 3], [3, 4], [3, 5]],
  },
  {
    name: "LEO", // Leo — sickle + body
    pts: [[-0.4, 0.25], [-0.25, 0.35], [-0.05, 0.30], [0.05, 0.10], [-0.05, -0.10], [0.20, -0.20], [0.40, -0.10]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 5]],
  },
  {
    name: "VIR", // Virgo — winged maiden, elongated
    pts: [[-0.45, -0.05], [-0.20, 0.0], [-0.05, 0.20], [0.10, -0.05], [0.30, 0.10], [0.45, -0.15], [0.05, -0.25]],
    edges: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [3, 6]],
  },
  {
    name: "LIB", // Libra — scale triangle + arms
    pts: [[-0.40, 0.10], [0.0, -0.25], [0.40, 0.10], [-0.25, 0.30], [0.25, 0.30]],
    edges: [[0, 1], [1, 2], [0, 3], [2, 4], [0, 2]],
  },
  {
    name: "SCO", // Scorpio — curved tail with stinger
    pts: [[-0.45, -0.20], [-0.30, -0.05], [-0.10, 0.05], [0.10, 0.05], [0.25, -0.05], [0.35, -0.20], [0.30, -0.35], [0.15, -0.40], [0.0, -0.30]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
  },
  {
    name: "SGR", // Sagittarius — archer bow
    pts: [[-0.40, 0.20], [-0.15, 0.05], [0.0, -0.10], [0.20, -0.05], [0.40, 0.10], [0.10, 0.30], [-0.10, 0.30]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [3, 6], [5, 6]],
  },
  {
    name: "CAP", // Capricorn — sea-goat angular
    pts: [[-0.40, -0.10], [-0.15, 0.10], [0.10, 0.05], [0.30, -0.10], [0.40, -0.30], [0.15, -0.30]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
  },
  {
    name: "AQR", // Aquarius — water-bearer zigzag
    pts: [[-0.45, 0.15], [-0.20, -0.10], [0.0, 0.10], [0.20, -0.10], [0.45, 0.15], [-0.10, 0.30], [0.30, 0.30]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [3, 6]],
  },
  {
    name: "PSC", // Pisces — two fish on a line
    pts: [[-0.45, 0.20], [-0.30, 0.05], [-0.15, 0.10], [0.0, 0.0], [0.20, -0.10], [0.40, -0.20], [0.30, -0.05]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 4]],
  },
];

interface Placed {
  con: Constellation;
  ax: number;       // anchor x (0..1)
  ay: number;       // anchor y (0..1)
  scale: number;    // % of min(w,h)
  rot: number;      // radians
  zBand: 0 | 1 | 2; // parallax depth
}

interface PulseState {
  index: number;    // index into placed[]
  startedAt: number;
}

function placeAll(): Placed[] {
  // Hand-tuned 4×3 jittered grid → keeps the centre breathing room around the
  // hero copy and spreads constellations evenly otherwise.
  const grid: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      grid.push({
        x: 0.10 + col * 0.27,
        y: 0.12 + row * 0.32,
      });
    }
  }
  return ZODIAC.map((con, i) => {
    const cell = grid[i];
    const rng = (s: number) => (Math.sin(s * 13.37 + i * 1.91) * 0.5 + 0.5);
    return {
      con,
      ax: cell.x + (rng(1) - 0.5) * 0.04,
      ay: cell.y + (rng(2) - 0.5) * 0.05,
      scale: 0.11 + rng(3) * 0.04,
      rot: (rng(4) - 0.5) * 0.35,
      zBand: (i % 3) as 0 | 1 | 2,
    };
  });
}

const PARALLAX_OFFSET = [4, 9, 16] as const;

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

    // Pointer parallax — normalized -1..1, smoothed per frame.
    let targetMx = 0, targetMy = 0;
    let mx = 0, my = 0;

    // Stable starfield seeded once per resize.
    let starfield: { x: number; y: number; a: number }[] = [];

    let nextPulse = performance.now() + PULSE_INTERVAL_MS;
    let pulse: PulseState | null = null;

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      starfield = [];
      for (let i = 0; i < STARFIELD_COUNT; i++) {
        starfield.push({
          x: Math.random() * w,
          y: Math.random() * h,
          a: 0.10 + Math.random() * 0.25,
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

      // Lerp pointer towards target.
      mx += (targetMx - mx) * 0.08;
      my += (targetMy - my) * 0.08;

      // Background — deep cosmic gradient.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#06091a");
      bg.addColorStop(1, "#0c1530");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Static starfield dust.
      for (const s of starfield) {
        ctx.fillStyle = `rgba(219, 233, 255, ${s.a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, 1, 1);
      }

      // Pulse scheduling.
      if (now >= nextPulse && !pulse) {
        pulse = { index: Math.floor(Math.random() * placed.length), startedAt: now };
        nextPulse = now + PULSE_INTERVAL_MS + Math.random() * 2000;
      }
      const pulseAge = pulse ? (now - pulse.startedAt) / PULSE_DUR_MS : 1;
      if (pulse && pulseAge >= 1) pulse = null;

      const minDim = Math.min(w, h);

      // Render each constellation.
      placed.forEach((p, i) => {
        const offX = PARALLAX_OFFSET[p.zBand] * mx;
        const offY = PARALLAX_OFFSET[p.zBand] * my;
        const cx = p.ax * w + offX;
        const cy = p.ay * h + offY;
        const scl = p.scale * minDim;
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);

        // Pre-transform local star positions to screen space.
        const screenPts = p.con.pts.map(([lx, ly]) => ({
          x: cx + (lx * cos - ly * sin) * scl,
          y: cy + (lx * sin + ly * cos) * scl,
        }));

        const isPulsing = pulse?.index === i;
        const pulseAmt = isPulsing
          ? Math.sin(pulseAge * Math.PI) * (1 - pulseAge * 0.4) // 0→peak→fade
          : 0;

        // Edges first (under stars).
        ctx.lineWidth = 0.7 + pulseAmt * 1.1;
        ctx.strokeStyle = `rgba(170, 200, 240, ${(0.22 + pulseAmt * 0.55).toFixed(3)})`;
        for (const [a, b] of p.con.edges) {
          ctx.beginPath();
          ctx.moveTo(screenPts[a].x, screenPts[a].y);
          ctx.lineTo(screenPts[b].x, screenPts[b].y);
          ctx.stroke();
        }

        // Stars.
        for (const sp of screenPts) {
          const baseR = 1.6 + (p.zBand + 1) * 0.4 + pulseAmt * 1.4;
          // Halo
          const halo = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, baseR * 4.5);
          halo.addColorStop(0, `rgba(219, 233, 255, ${(0.38 + pulseAmt * 0.45).toFixed(3)})`);
          halo.addColorStop(1, "rgba(219, 233, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, baseR * 4.5, 0, Math.PI * 2);
          ctx.fill();
          // Core
          ctx.fillStyle = `rgba(235, 244, 255, ${(0.92 + pulseAmt * 0.08).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, baseR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Latin name label — small mono caption beside anchor.
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
