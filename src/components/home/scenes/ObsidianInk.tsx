// Obsidian Ink — light-mode Canvas2D scene. Ink-on-paper aesthetic.
//
// A handful of soft sumi-e ink blots diffuse into a cream paper background.
// Cheap enough to flag `lightweight: true` in the registry so it bypasses the
// hardwareConcurrency<4 guard and runs on 2-core devices.
//
// ThemeToggle pins next-themes to "light" when this scene is active, so the
// Home UI tokens (mapped to --home-* CSS vars in index.css) automatically
// compose against the paper background.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 24; // ink barely moves — 24fps is plenty
const MAX_BLOTS = 7;
const SPAWN_INTERVAL_MS = 4200;
const FADE_IN_MS = 1400;

interface Blot {
  x: number;       // 0..1 in normalized canvas space
  y: number;       // 0..1
  radius: number;  // 0..1 of min(w,h)
  bornAt: number;  // performance.now()
  seed: number;    // per-blot turbulence seed
}

function rand(seed: number) {
  // Mulberry32 — deterministic per-seed jitter so each blot keeps its shape.
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function drawBlot(ctx: CanvasRenderingContext2D, b: Blot, w: number, h: number, now: number) {
  const age = Math.min(1, (now - b.bornAt) / FADE_IN_MS);
  const eased = 1 - Math.pow(1 - age, 3);
  const cx = b.x * w;
  const cy = b.y * h;
  const baseR = b.radius * Math.min(w, h) * eased;

  // Soft outer wash — radial gradient from ink to transparent.
  const grad = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, baseR);
  grad.addColorStop(0, "rgba(28, 25, 23, 0.22)");
  grad.addColorStop(0.55, "rgba(28, 25, 23, 0.08)");
  grad.addColorStop(1, "rgba(28, 25, 23, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.fill();

  // Darker satellite splotches around the centroid for the diffusion look.
  for (let i = 0; i < 5; i++) {
    const a = rand(b.seed + i) * Math.PI * 2;
    const dist = baseR * (0.25 + rand(b.seed * 7 + i) * 0.55);
    const r = baseR * (0.10 + rand(b.seed * 13 + i) * 0.18);
    const sx = cx + Math.cos(a) * dist;
    const sy = cy + Math.sin(a) * dist;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    sg.addColorStop(0, "rgba(28, 25, 23, 0.18)");
    sg.addColorStop(1, "rgba(28, 25, 23, 0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
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

    const blots: Blot[] = [];

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

    const spawnBlot = (now: number) => {
      const seed = (nextSeed = (nextSeed * 1103515245 + 12345) >>> 0);
      // Avoid the dead-center where the hero copy lives — keep blots in the
      // outer 60% of the canvas so they frame the content instead of
      // covering it.
      const onLeft = rand(seed) < 0.5;
      blots.push({
        x: onLeft ? rand(seed + 1) * 0.32 : 0.68 + rand(seed + 2) * 0.30,
        y: 0.08 + rand(seed + 3) * 0.84,
        radius: 0.18 + rand(seed + 4) * 0.22,
        bornAt: now,
        seed,
      });
      if (blots.length > MAX_BLOTS) blots.shift();
    };

    const start = performance.now();
    // Seed the canvas with a few blots so the first frame already has content.
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

      // Paper background — warm cream with two faint radial washes for depth.
      ctx.fillStyle = "#f5f3ee";
      ctx.fillRect(0, 0, w, h);

      const wash1 = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.7);
      wash1.addColorStop(0, "rgba(214, 198, 168, 0.25)");
      wash1.addColorStop(1, "rgba(214, 198, 168, 0)");
      ctx.fillStyle = wash1;
      ctx.fillRect(0, 0, w, h);

      const wash2 = ctx.createRadialGradient(w * 0.85, h * 0.9, 0, w * 0.85, h * 0.9, Math.max(w, h) * 0.6);
      wash2.addColorStop(0, "rgba(180, 160, 130, 0.18)");
      wash2.addColorStop(1, "rgba(180, 160, 130, 0)");
      ctx.fillStyle = wash2;
      ctx.fillRect(0, 0, w, h);

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
