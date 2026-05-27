// Mực Hắc Diệu (Obsidian Ink) — light-mode Canvas2D scene.
//
// Soft sumi-e ink diffusion. Each blot is rendered as a stack of jittered
// radial gradients (smooth falloff, no contour banding) plus a ring of tiny
// "fiber" gradient stamps perturbed by 2-octave value noise, so the rim
// bleeds into the paper irregularly. Blots paint under `multiply` blend, so
// overlapping blots compound darker — like real ink on washi.
//
// `lightweight: true` in the registry so it bypasses hardwareConcurrency<4.
// ThemeToggle pins next-themes to "light" when this scene is active.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 18;       // ink barely moves
const MAX_BLOTS = 7;
const SPAWN_INTERVAL_MS = 3200;
const FADE_IN_MS = 1600;
const FADE_OUT_MS = 1800;
const BLOT_TTL_MS = 14000;

const BODY_LAYERS = 7;            // stacked radial gradients per blot body
const FIBER_COUNT = 18;           // rim tendril stamps per blot
const DRIP_STAMPS = 6;            // radial stamps along a drip bezier

interface Blot {
  x: number;         // 0..1 normalized
  y: number;         // 0..1 normalized
  radius: number;    // 0..1 of min(w,h)
  bornAt: number;
  seed: number;
  drip: boolean;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 1D value-noise over angle θ (radians), seeded per blot. 2 octaves. */
function makeAngularFbm(seed: number): (theta: number) => number {
  // Pre-sample a small lookup table per octave; smoothstep between samples.
  const N1 = 12, N2 = 24;
  const rng = mulberry32(seed ^ 0x9e3779b1);
  const t1: number[] = []; for (let i = 0; i < N1; i++) t1.push(rng() * 2 - 1);
  const t2: number[] = []; for (let i = 0; i < N2; i++) t2.push(rng() * 2 - 1);
  const sample = (tbl: number[], theta: number) => {
    const n = tbl.length;
    const x = ((theta / (Math.PI * 2)) % 1 + 1) % 1 * n;
    const i = Math.floor(x);
    const f = x - i;
    const a = tbl[i % n];
    const b = tbl[(i + 1) % n];
    const u = f * f * (3 - 2 * f);
    return a * (1 - u) + b * u;
  };
  return (theta: number) => sample(t1, theta) * 0.65 + sample(t2, theta * 1.3 + 1.7) * 0.35;
}

/** Paint a single soft radial stamp. */
function radialStamp(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  centerAlpha: number,
) {
  if (r <= 0.5 || centerAlpha <= 0.002) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0,    `rgba(20, 16, 12, ${centerAlpha.toFixed(3)})`);
  g.addColorStop(0.55, `rgba(20, 16, 12, ${(centerAlpha * 0.35).toFixed(3)})`);
  g.addColorStop(1,    "rgba(20, 16, 12, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBlot(ctx: CanvasRenderingContext2D, b: Blot, w: number, h: number, now: number) {
  const age = now - b.bornAt;
  const fadeIn = Math.min(1, age / FADE_IN_MS);
  const fadeOut = age > BLOT_TTL_MS
    ? Math.max(0, 1 - (age - BLOT_TTL_MS) / FADE_OUT_MS)
    : 1;
  const eased = 1 - Math.pow(1 - fadeIn, 3);
  const alphaMul = eased * fadeOut;
  if (alphaMul <= 0.002) return;

  const cx = b.x * w;
  const cy = b.y * h;
  const baseR = b.radius * Math.min(w, h) * (0.92 + 0.08 * eased);

  const rng = mulberry32(b.seed);
  rng(); rng();
  const fbm = makeAngularFbm(b.seed);

  // --- Body: stacked radial gradients with jittered centers/radii ---
  // Innermost stamps are small + dark; outermost are wide + faint. Sum
  // produces a smooth falloff (no visible contour bands).
  for (let i = 0; i < BODY_LAYERS; i++) {
    const t = i / (BODY_LAYERS - 1); // 0..1
    const ox = (rng() - 0.5) * baseR * 0.30;
    const oy = (rng() - 0.5) * baseR * 0.30;
    // Radius grows from 0.55 → 1.9 baseR, slight per-stamp jitter.
    const r = baseR * (0.55 + t * 1.35) * (0.92 + rng() * 0.16);
    // Alpha tapers from ~0.38 (small/dark center) → ~0.04 (wide halo).
    const a = (0.38 - t * 0.34) * alphaMul;
    radialStamp(ctx, cx + ox, cy + oy, r, a);
  }

  // --- Edge fiber bleed: tendrils perturbed by angular fbm ---
  for (let i = 0; i < FIBER_COUNT; i++) {
    const theta = (i / FIBER_COUNT) * Math.PI * 2 + rng() * 0.18;
    const noise = fbm(theta);                       // -1..1
    const rimR = baseR * (1.0 + 0.22 * noise);      // bleed in/out of edge
    const fx = cx + Math.cos(theta) * rimR;
    const fy = cy + Math.sin(theta) * rimR;
    const stampR = baseR * (0.10 + rng() * 0.06);
    const a = (0.11 + Math.max(0, noise) * 0.06) * alphaMul;
    radialStamp(ctx, fx, fy, stampR, a);
  }

  // --- Optional drip: bezier of small radial stamps, alpha tapering down ---
  if (b.drip) {
    const drng = mulberry32(b.seed ^ 0xa11ce);
    const dripLen = baseR * (1.6 + drng() * 1.8);
    const sway = (drng() - 0.5) * baseR * 0.8;
    const x0 = cx + (drng() - 0.5) * baseR * 0.3;
    const y0 = cy + baseR * 0.8;
    const cp1x = x0 + sway,         cp1y = y0 + dripLen * 0.40;
    const cp2x = x0 + sway * 0.5,   cp2y = y0 + dripLen * 0.75;
    const x1 = x0 + sway * 0.2,     y1 = y0 + dripLen;
    for (let i = 0; i < DRIP_STAMPS; i++) {
      const t = i / (DRIP_STAMPS - 1);
      const it = 1 - t;
      // Cubic bezier point.
      const bx = it*it*it*x0 + 3*it*it*t*cp1x + 3*it*t*t*cp2x + t*t*t*x1;
      const by = it*it*it*y0 + 3*it*it*t*cp1y + 3*it*t*t*cp2y + t*t*t*y1;
      const r = baseR * (0.22 - t * 0.14);
      const a = (0.26 - t * 0.20) * alphaMul;
      radialStamp(ctx, bx, by, r, a);
    }
  }
}

/** Pre-build paper grain + diagonal fibers into an offscreen canvas. */
function buildPaperTexture(w: number, h: number, dpr: number): HTMLCanvasElement | OffscreenCanvas {
  const cw = Math.max(1, Math.floor(w * dpr));
  const ch = Math.max(1, Math.floor(h * dpr));
  const off = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const octx = (off as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
  if (!octx) return off as HTMLCanvasElement;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const img = octx.createImageData(cw, ch);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const dark = v < 0.5;
    img.data[i]     = dark ? 70 : 230;
    img.data[i + 1] = dark ? 62 : 222;
    img.data[i + 2] = dark ? 50 : 200;
    img.data[i + 3] = (Math.random() * 14) | 0;
  }
  octx.putImageData(img, 0, 0);

  octx.strokeStyle = "rgba(110, 95, 75, 0.045)";
  octx.lineWidth = 0.6;
  for (let i = 0; i < 60; i++) {
    const y0 = Math.random() * h;
    const x0 = -20;
    const len = w + 40;
    octx.beginPath();
    octx.moveTo(x0, y0);
    octx.lineTo(x0 + len, y0 + (Math.random() - 0.5) * h * 0.6);
    octx.stroke();
  }
  return off as HTMLCanvasElement;
}

export default function ObsidianInk({ paused, onReady }: SceneProps) {
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
    let rafId = 0, lastFrame = 0, nextSpawn = 0;
    let nextSeed = Math.floor(Math.random() * 0xffffff);
    let paperTexture: HTMLCanvasElement | OffscreenCanvas | null = null;

    const blots: Blot[] = [];

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paperTexture = buildPaperTexture(w, h, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const spawnBlot = (now: number) => {
      const seed = (nextSeed = (nextSeed * 1103515245 + 12345) >>> 0);
      const rng = mulberry32(seed);
      const onLeft = rng() < 0.5;
      blots.push({
        x: onLeft ? rng() * 0.32 : 0.68 + rng() * 0.30,
        y: 0.08 + rng() * 0.78,
        radius: 0.10 + rng() * 0.10,
        bornAt: now,
        seed,
        drip: rng() < 0.20,
      });
      while (blots.length > 0 && now - blots[0].bornAt > BLOT_TTL_MS + FADE_OUT_MS) {
        blots.shift();
      }
      while (blots.length > MAX_BLOTS) blots.shift();
    };

    const start = performance.now();
    for (let i = 0; i < 3; i++) spawnBlot(start - FADE_IN_MS - i * 600);
    nextSpawn = start + SPAWN_INTERVAL_MS;

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Warm paper base.
      ctx.fillStyle = "#f5f0e6";
      ctx.fillRect(0, 0, w, h);

      // Corner washes.
      const wash1 = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.7);
      wash1.addColorStop(0, "rgba(214, 198, 168, 0.22)");
      wash1.addColorStop(1, "rgba(214, 198, 168, 0)");
      ctx.fillStyle = wash1; ctx.fillRect(0, 0, w, h);
      const wash2 = ctx.createRadialGradient(w * 0.85, h * 0.9, 0, w * 0.85, h * 0.9, Math.max(w, h) * 0.6);
      wash2.addColorStop(0, "rgba(180, 160, 130, 0.16)");
      wash2.addColorStop(1, "rgba(180, 160, 130, 0)");
      ctx.fillStyle = wash2; ctx.fillRect(0, 0, w, h);

      // Paper grain + fibers.
      if (paperTexture) ctx.drawImage(paperTexture as CanvasImageSource, 0, 0, w, h);

      // Ink blots — multiply blend so overlap compounds darker.
      ctx.globalCompositeOperation = "multiply";
      for (const b of blots) drawBlot(ctx, b, w, h, now);
      ctx.globalCompositeOperation = "source-over";

      if (now >= nextSpawn) {
        spawnBlot(now);
        nextSpawn = now + SPAWN_INTERVAL_MS + (Math.random() - 0.5) * 1200;
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
