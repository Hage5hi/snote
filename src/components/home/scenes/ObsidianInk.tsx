// Mực Hắc Diệu (Obsidian Ink) — light-mode Canvas2D scene.
//
// Sumi-e ink diffusion. Each blot is a stack of irregular, fbm-distorted
// closed polygons (NOT radial gradients, NOT dot rings). Layers paint under
// `multiply` blend so overlapping low-alpha ink compounds darker — like
// real ink bleeding into Xuan paper. A high-frequency monochromatic grain
// overlay sits between the warm washes and the ink so blots read as
// soaking *into* the paper.
//
// `lightweight: true` in the registry so it bypasses hardwareConcurrency<4.
// ThemeToggle pins next-themes to "light" when this scene is active.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 15;
const MAX_BLOTS = 7;
const SPAWN_INTERVAL_MS = 3200;
const FADE_IN_MS = 1600;
const FADE_OUT_MS = 1800;
const BLOT_TTL_MS = 14000;

const STEPS = 96;            // angle samples per blob path
const LAYERS = 14;           // capillary-bleed layers per blot
const CORE_LAYERS = 2;       // small dark wet-centre layers
const DRIP_LAYERS = 6;

interface Blot {
  x: number;
  y: number;
  radius: number;
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

// --- 2D value noise + fbm, seeded per blot ----------------------------------
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393) ^ (iy * 668265263) ^ (seed * 2147483647);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix,     iy,     seed);
  const b = hash2(ix + 1, iy,     seed);
  const c = hash2(ix,     iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
function fbm2(x: number, y: number, seed: number): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * (vnoise2(x * freq, y * freq, seed + i * 91) * 2 - 1);
    freq *= 2.07;
    amp *= 0.5;
  }
  return v; // ~-1..1
}

/** Draw a closed noise-distorted blob path. */
function fillBlobPath(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, baseR: number,
  seed: number, freq: number, stretchDown: number,
  fill: string,
) {
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const theta = t * Math.PI * 2;
    const ct = Math.cos(theta), st = Math.sin(theta);
    // Seamless across θ by sampling fbm on the unit circle.
    const n1 = fbm2(ct * freq,        st * freq,        seed);
    const n2 = fbm2(ct * freq * 2.1,  st * freq * 2.1,  seed + 1) * 0.5;
    const distort = 1 + 0.55 * n1 + 0.25 * n2;
    // Optional downward stretch for drips.
    const tongue = stretchDown > 0 ? 1 + stretchDown * Math.max(0, -st) : 1;
    const r = baseR * distort * tongue;
    const x = cx + ct * r;
    const y = cy + st * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
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
  const jitter = mulberry32(b.seed ^ 0x51ab1e);

  const stretch = b.drip ? 1.6 : 0;

  // Capillary bleed: each layer is a *different* fbm-distorted shape.
  // Alpha tapers from 0.05 (innermost) → 0.018 (outermost).
  for (let i = 0; i < LAYERS; i++) {
    const t = i / (LAYERS - 1);
    const scale = 1.0 + i * 0.045;
    const freq = 1.6 + i * 0.07;
    const ox = (jitter() - 0.5) * baseR * 0.16;
    const oy = (jitter() - 0.5) * baseR * 0.16;
    const a = (0.05 - t * 0.032) * alphaMul;
    fillBlobPath(
      ctx, cx + ox, cy + oy, baseR * scale,
      b.seed + i * 17, freq, stretch,
      `rgba(15, 12, 10, ${a.toFixed(3)})`,
    );
  }

  // Wet-centre cores — small darker irregular blobs, no gradient.
  for (let i = 0; i < CORE_LAYERS; i++) {
    const ox = (jitter() - 0.5) * baseR * 0.08;
    const oy = (jitter() - 0.5) * baseR * 0.08;
    fillBlobPath(
      ctx, cx + ox, cy + oy, baseR * (0.38 + i * 0.08),
      b.seed + 503 + i * 31, 2.2 + i * 0.4, 0,
      `rgba(15, 12, 10, ${(0.06 * alphaMul).toFixed(3)})`,
    );
  }

  // Drip tongue: same blob distortion, just elongated downward.
  if (b.drip) {
    const dy = baseR * 0.45;
    for (let i = 0; i < DRIP_LAYERS; i++) {
      const t = i / (DRIP_LAYERS - 1);
      const scale = 0.55 - t * 0.30;
      const a = (0.045 - t * 0.030) * alphaMul;
      if (a <= 0.002) continue;
      fillBlobPath(
        ctx, cx + (jitter() - 0.5) * baseR * 0.1, cy + dy + t * baseR * 0.6,
        baseR * scale, b.seed + 911 + i * 13, 2.0, 1.2,
        `rgba(15, 12, 10, ${a.toFixed(3)})`,
      );
    }
  }
}

/** Pre-build Xuan paper grain (monochromatic high-freq speckle, 2 passes). */
function buildPaperTexture(w: number, h: number, dpr: number): HTMLCanvasElement | OffscreenCanvas {
  const cw = Math.max(1, Math.floor(w * dpr));
  const ch = Math.max(1, Math.floor(h * dpr));
  const off = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const octx = (off as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
  if (!octx) return off as HTMLCanvasElement;

  const img = octx.createImageData(cw, ch);
  // Pass 1: dense fine grain.
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const dark = v < 0.5;
    img.data[i]     = dark ? 70 : 230;
    img.data[i + 1] = dark ? 62 : 222;
    img.data[i + 2] = dark ? 50 : 200;
    img.data[i + 3] = (Math.random() * 22) | 0;
  }
  // Pass 2: sparser warm speckle on top.
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.random() > 0.25) continue;
    const dark = Math.random() < 0.6;
    const a = (Math.random() * 10) | 0;
    // Composite onto existing pixel (source-over alpha mix).
    const sa = a / 255;
    const sr = dark ? 90 : 240;
    const sg = dark ? 78 : 228;
    const sb = dark ? 60 : 210;
    const da = img.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;
    img.data[i]     = (sr * sa + img.data[i]     * da * (1 - sa)) / outA;
    img.data[i + 1] = (sg * sa + img.data[i + 1] * da * (1 - sa)) / outA;
    img.data[i + 2] = (sb * sa + img.data[i + 2] * da * (1 - sa)) / outA;
    img.data[i + 3] = (outA * 255) | 0;
  }
  octx.putImageData(img, 0, 0);
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

      // Paper grain — drawn BEFORE ink so blots sit "in" the grain.
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
