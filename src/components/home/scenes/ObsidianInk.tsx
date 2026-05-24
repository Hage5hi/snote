// Obsidian Ink v2 — sumi-e blots with perturbed edges, wet-edge ring, rare
// drips, and a procedural paper-grain texture. Canvas2D, lightweight, runs
// on 2-core devices (registry sets `lightweight: true`).
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 24;
const MAX_BLOTS = 7;
const SPAWN_INTERVAL_MS = 4200;
const FADE_IN_MS = 1400;

interface Blot {
  x: number;       // 0..1
  y: number;       // 0..1
  radius: number;  // 0..1 of min(w,h)
  bornAt: number;
  seed: number;
  /** When >0, draw a vertical drip running this many px down from the blot. */
  drip: number;
}

function rand(seed: number) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Perturbed circle — outlines a closed path with per-vertex jitter so the
// outer edge of each ink blot has the irregular feathered shape of real sumi.
function perturbedBlotPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  jitter: number,
) {
  const steps = 28;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Two-octave noise via deterministic rand seeded per vertex/seed.
    const j1 = (rand(seed + i) - 0.5) * jitter;
    const j2 = (rand(seed * 7 + i * 3) - 0.5) * jitter * 0.4;
    const rr = r * (1 + j1 + j2);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBlot(ctx: CanvasRenderingContext2D, b: Blot, w: number, h: number, now: number) {
  const age = Math.min(1, (now - b.bornAt) / FADE_IN_MS);
  const eased = 1 - Math.pow(1 - age, 3);
  const cx = b.x * w;
  const cy = b.y * h;
  const baseR = b.radius * Math.min(w, h) * eased;

  // Soft outer wash with irregular feathered edge.
  ctx.save();
  perturbedBlotPath(ctx, cx, cy, baseR, b.seed, 0.18);
  const grad = ctx.createRadialGradient(cx, cy, baseR * 0.05, cx, cy, baseR);
  grad.addColorStop(0, "rgba(26, 20, 16, 0.26)");
  grad.addColorStop(0.55, "rgba(26, 20, 16, 0.09)");
  grad.addColorStop(1, "rgba(26, 20, 16, 0)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Wet-edge ring — a faint darker outline at the perturbed boundary.
  perturbedBlotPath(ctx, cx, cy, baseR * 0.96, b.seed + 11, 0.20);
  ctx.lineWidth = Math.max(0.6, baseR * 0.02);
  ctx.strokeStyle = "rgba(26, 20, 16, 0.10)";
  ctx.stroke();
  ctx.restore();

  // Darker satellite splotches around the centroid for diffusion look.
  for (let i = 0; i < 5; i++) {
    const a = rand(b.seed + i) * Math.PI * 2;
    const dist = baseR * (0.25 + rand(b.seed * 7 + i) * 0.55);
    const r = baseR * (0.10 + rand(b.seed * 13 + i) * 0.18);
    const sx = cx + Math.cos(a) * dist;
    const sy = cy + Math.sin(a) * dist;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    sg.addColorStop(0, "rgba(26, 20, 16, 0.20)");
    sg.addColorStop(1, "rgba(26, 20, 16, 0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rare drip — a thin tapered line dropping below the blot.
  if (b.drip > 0) {
    const dripLen = b.drip * eased;
    const startY = cy + baseR * 0.6;
    const endY = startY + dripLen;
    const dx = (rand(b.seed + 99) - 0.5) * baseR * 0.15;
    const grd = ctx.createLinearGradient(0, startY, 0, endY);
    grd.addColorStop(0, "rgba(26, 20, 16, 0.28)");
    grd.addColorStop(1, "rgba(26, 20, 16, 0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(cx - 1.6, startY);
    ctx.quadraticCurveTo(cx + dx, (startY + endY) / 2, cx + dx * 0.6, endY);
    ctx.quadraticCurveTo(cx + dx, (startY + endY) / 2, cx + 1.6, startY);
    ctx.closePath();
    ctx.fill();
  }
}

/** Tile a procedural paper-grain noise pattern onto an offscreen canvas once. */
function buildPaperGrain(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  const size = 96;
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) return tile;
  const img = tctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Warm sepia speck with low alpha so the texture is felt, not seen.
    const v = (Math.random() * 60) | 0;
    img.data[i + 0] = 80 + v;
    img.data[i + 1] = 65 + v * 0.85;
    img.data[i + 2] = 45 + v * 0.6;
    img.data[i + 3] = Math.random() < 0.18 ? 18 : 0;
  }
  tctx.putImageData(img, 0, 0);
  return tile;
}

export default function ObsidianInk({ paused, onReady }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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
    let w = 1;
    let h = 1;
    let rafId = 0;
    let lastFrame = 0;
    let nextSpawn = 0;
    let nextSeed = Math.floor(Math.random() * 0xffffff);
    const paperGrain = buildPaperGrain();
    let grainPattern: CanvasPattern | null = ctx.createPattern(paperGrain, "repeat");

    const blots: Blot[] = [];

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Patterns are tied to the context's transform — recreate on resize.
      grainPattern = ctx.createPattern(paperGrain, "repeat");
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const spawnBlot = (now: number) => {
      const seed = (nextSeed = (nextSeed * 1103515245 + 12345) >>> 0);
      const onLeft = rand(seed) < 0.5;
      const r = rand(seed + 4);
      blots.push({
        x: onLeft ? rand(seed + 1) * 0.32 : 0.68 + rand(seed + 2) * 0.30,
        y: 0.08 + rand(seed + 3) * 0.74,
        radius: 0.18 + r * 0.22,
        bornAt: now,
        seed,
        drip: rand(seed + 5) < 0.25
          ? 30 + rand(seed + 6) * 50
          : 0,
      });
      if (blots.length > MAX_BLOTS) blots.shift();
    };

    const start = performance.now();
    for (let i = 0; i < 3; i++) spawnBlot(start - FADE_IN_MS);
    nextSpawn = start + SPAWN_INTERVAL_MS;

    const tick = (now: number) => {
      if (pausedRef.current) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (now - lastFrame < FRAME_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      // Warm cream paper base.
      ctx.fillStyle = "#f4f0e6";
      ctx.fillRect(0, 0, w, h);

      // Two soft radial washes for warmth/depth.
      const wash1 = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.7);
      wash1.addColorStop(0, "rgba(214, 198, 168, 0.26)");
      wash1.addColorStop(1, "rgba(214, 198, 168, 0)");
      ctx.fillStyle = wash1;
      ctx.fillRect(0, 0, w, h);

      const wash2 = ctx.createRadialGradient(w * 0.85, h * 0.9, 0, w * 0.85, h * 0.9, Math.max(w, h) * 0.6);
      wash2.addColorStop(0, "rgba(180, 160, 130, 0.20)");
      wash2.addColorStop(1, "rgba(180, 160, 130, 0)");
      ctx.fillStyle = wash2;
      ctx.fillRect(0, 0, w, h);

      // Paper grain texture (cheap, tiled pattern).
      if (grainPattern) {
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, w, h);
      }

      // Diagonal fibre lines — extremely faint, 12 of them.
      ctx.save();
      ctx.strokeStyle = "rgba(120, 95, 60, 0.045)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const off = ((i / 12) * (w + h)) - h * 0.4;
        ctx.beginPath();
        ctx.moveTo(off, 0);
        ctx.lineTo(off + h * 0.6, h);
        ctx.stroke();
      }
      ctx.restore();

      // Ink blots multiply onto the paper for the "bleed-through" effect.
      ctx.globalCompositeOperation = "multiply";
      for (const b of blots) drawBlot(ctx, b, w, h, now);
      ctx.globalCompositeOperation = "source-over";

      if (now >= nextSpawn) {
        spawnBlot(now);
        nextSpawn = now + SPAWN_INTERVAL_MS;
      }

      if (onReadyRef.current) {
        onReadyRef.current();
        onReadyRef.current = undefined;
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      try {
        host.removeChild(canvas);
      } catch {
        /* already detached */
      }
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
