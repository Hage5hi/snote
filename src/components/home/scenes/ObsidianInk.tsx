// Mực Hắc Diệu (Obsidian Ink) — light-mode Canvas2D scene.
//
// Structured sumi-e ink blots diffusing into warm paper. Each blot is a
// star-shaped polygon (8–12 perturbed vertices on a circle) rendered as
// three concentric diffusion rings + a wet edge + an occasional drip. Paper
// grain and fiber lines are pre-rendered once into an offscreen canvas and
// blitted each frame so the loop stays cheap.
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
const BLOT_TTL_MS = 14000;        // lifetime before fade-out begins

interface Blot {
  x: number;         // 0..1 in normalized canvas space
  y: number;         // 0..1
  radius: number;    // 0..1 of min(w,h)
  bornAt: number;    // performance.now()
  seed: number;      // per-blot rng seed (deterministic shape)
  drip: boolean;     // 1/5 chance — has a downward tail
  vertices: number;  // 8..12 polygon points
}

function mulberry32(seed: number) {
  // Returns a stateful rng so we can advance through deterministic samples.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pre-compute the perturbed polygon for a blot once (cached on the object). */
function blotPolygon(b: Blot, baseR: number): { x: number; y: number }[] {
  const rng = mulberry32(b.seed);
  // Skip the first few samples so seed=0 doesn't bias.
  rng(); rng();
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < b.vertices; i++) {
    const a = (i / b.vertices) * Math.PI * 2;
    // Structured edge noise: smooth perturbation per vertex.
    const jitter = 0.78 + rng() * 0.40; // 0.78..1.18 — gentle, no spikes
    const r = baseR * jitter;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

function tracePolygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, pts: { x: number; y: number }[], scale: number) {
  ctx.beginPath();
  ctx.moveTo(cx + pts[0].x * scale, cy + pts[0].y * scale);
  // Quadratic curves through midpoints → smooth, paper-natural diffusion edges.
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % pts.length];
    const mx = (cur.x + nxt.x) * 0.5;
    const my = (cur.y + nxt.y) * 0.5;
    ctx.quadraticCurveTo(cx + cur.x * scale, cy + cur.y * scale, cx + mx * scale, cy + my * scale);
  }
  ctx.closePath();
}

function drawBlot(ctx: CanvasRenderingContext2D, b: Blot, w: number, h: number, now: number) {
  const age = now - b.bornAt;
  const fadeIn = Math.min(1, age / FADE_IN_MS);
  const fadeOut = age > BLOT_TTL_MS
    ? Math.max(0, 1 - (age - BLOT_TTL_MS) / FADE_OUT_MS)
    : 1;
  const easedIn = 1 - Math.pow(1 - fadeIn, 3);
  const alphaMul = easedIn * fadeOut;
  if (alphaMul <= 0.001) return;

  const cx = b.x * w;
  const cy = b.y * h;
  const baseR = b.radius * Math.min(w, h) * (0.92 + 0.08 * easedIn);
  const poly = blotPolygon(b, 1);

  // Three concentric diffusion rings: core, mid, halo.
  // Each is the same polygon scaled up, painted with successively lower alpha.
  const rings = [
    { scale: 1.00 * baseR, color: `rgba(26, 20, 16, ${(0.85 * alphaMul).toFixed(3)})` },
    { scale: 1.35 * baseR, color: `rgba(26, 20, 16, ${(0.32 * alphaMul).toFixed(3)})` },
    { scale: 1.85 * baseR, color: `rgba(26, 20, 16, ${(0.14 * alphaMul).toFixed(3)})` },
  ];
  // Paint halo → mid → core so darker layers stack on top.
  for (let i = rings.length - 1; i >= 0; i--) {
    ctx.fillStyle = rings[i].color;
    tracePolygon(ctx, cx, cy, poly, rings[i].scale);
    ctx.fill();
  }

  // Wet-edge dark ring: a slightly larger polygon stroked thin, darker than
  // the core. Gives the "just-dried sumi" look.
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(12, 9, 7, ${(0.18 * alphaMul).toFixed(3)})`;
  tracePolygon(ctx, cx, cy, poly, 1.05 * baseR);
  ctx.stroke();

  // Drip — Bezier tail descending below the blot.
  if (b.drip) {
    const rng = mulberry32(b.seed ^ 0xa11ce);
    const dripLen = baseR * (1.6 + rng() * 1.8);
    const sway = (rng() - 0.5) * baseR * 0.8;
    const dripX = cx + (rng() - 0.5) * baseR * 0.4;
    const dripY = cy + baseR * 0.85;
    const cp1x = dripX + sway;
    const cp1y = dripY + dripLen * 0.4;
    const cp2x = dripX + sway * 0.5;
    const cp2y = dripY + dripLen * 0.75;
    const endX = dripX + sway * 0.2;
    const endY = dripY + dripLen;

    // Three taper strokes — width drops along the drip.
    const taperSteps = 4;
    for (let i = 0; i < taperSteps; i++) {
      const tt = i / (taperSteps - 1);
      ctx.lineWidth = (1.0 - tt * 0.7) * 2.2;
      ctx.strokeStyle = `rgba(26, 20, 16, ${((0.28 - tt * 0.20) * alphaMul).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(dripX, dripY);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();
    }
  }
}

/** Build the paper texture (grain + diagonal fibers) into an offscreen canvas. */
function buildPaperTexture(w: number, h: number, dpr: number): HTMLCanvasElement | OffscreenCanvas {
  const cw = Math.max(1, Math.floor(w * dpr));
  const ch = Math.max(1, Math.floor(h * dpr));
  const off = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const octx = (off as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
  if (!octx) return off as HTMLCanvasElement;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Grain: per-pixel low-alpha speckle in two tones.
  const img = octx.createImageData(cw, ch);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const dark = v < 0.5;
    img.data[i]     = dark ? 70 : 230;
    img.data[i + 1] = dark ? 62 : 222;
    img.data[i + 2] = dark ? 50 : 200;
    img.data[i + 3] = (Math.random() * 14) | 0; // 0..14 alpha
  }
  octx.putImageData(img, 0, 0);

  // Diagonal fibers — thin lines at random offsets.
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
        x: onLeft ? rng() * 0.30 : 0.70 + rng() * 0.28,
        y: 0.08 + rng() * 0.78,
        radius: 0.10 + rng() * 0.10,
        bornAt: now,
        seed,
        drip: rng() < 0.20,
        vertices: 8 + Math.floor(rng() * 5), // 8..12
      });
      // Prune blots that have fully faded out.
      while (blots.length > 0 && now - blots[0].bornAt > BLOT_TTL_MS + FADE_OUT_MS) {
        blots.shift();
      }
      while (blots.length > MAX_BLOTS) blots.shift();
    };

    const start = performance.now();
    // Seed a few blots so the first frame already has content.
    for (let i = 0; i < 3; i++) spawnBlot(start - FADE_IN_MS - i * 600);
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

      // Warm paper background.
      ctx.fillStyle = "#f5f0e6";
      ctx.fillRect(0, 0, w, h);

      // Soft corner washes — gives the paper subtle depth.
      const wash1 = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.7);
      wash1.addColorStop(0, "rgba(214, 198, 168, 0.22)");
      wash1.addColorStop(1, "rgba(214, 198, 168, 0)");
      ctx.fillStyle = wash1;
      ctx.fillRect(0, 0, w, h);

      const wash2 = ctx.createRadialGradient(w * 0.85, h * 0.9, 0, w * 0.85, h * 0.9, Math.max(w, h) * 0.6);
      wash2.addColorStop(0, "rgba(180, 160, 130, 0.16)");
      wash2.addColorStop(1, "rgba(180, 160, 130, 0)");
      ctx.fillStyle = wash2;
      ctx.fillRect(0, 0, w, h);

      // Paper grain + fibers — pre-rendered, just blit.
      if (paperTexture) {
        ctx.drawImage(paperTexture as CanvasImageSource, 0, 0, w, h);
      }

      // Ink blots — multiply blend so they bleed into the paper.
      ctx.globalCompositeOperation = "multiply";
      for (const b of blots) drawBlot(ctx, b, w, h, now);
      ctx.globalCompositeOperation = "source-over";

      if (now >= nextSpawn) {
        spawnBlot(now);
        nextSpawn = now + SPAWN_INTERVAL_MS + (Math.random() - 0.5) * 1200;
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
