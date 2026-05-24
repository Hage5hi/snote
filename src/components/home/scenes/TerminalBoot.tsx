// Terminal Boot v2 — phosphor matrix rain with a boot-text overlay that
// scrolls once on mount, head-of-stream halos, full-canvas scanlines, and a
// rare CRT flicker. Canvas2D, lightweight.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 24;
const FONT_PX = 14;
// Mixed glyphs — katakana, latin, symbols, a few CJK for visual variety.
const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノ" +
  "0123456789<>/*+-=#$@" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "符令道風空無虛靈";

const BOOT_LINES = [
  "BIOS v2.18.07  Phosphor-CRT BOOT",
  "MEM 64K OK",
  "DETECTING TTY... /dev/console",
  "LOAD KERNEL  [....] OK",
  "MOUNT /sys   OK",
  "MOUNT /usr   OK",
  "INIT runlevel 3",
  "STARTING net.eth0... up",
  "STARTING phosphor-trace... ok",
  "STARTING glyph-rain... ok",
  "WELCOME.",
  "$ _",
];

const BOOT_TOTAL_MS = 8000;        // total visible duration
const BOOT_PER_LINE_MS = 350;      // delay between successive lines
const BOOT_FADE_OUT_MS = 1500;

export default function TerminalBoot({ paused, onReady }: SceneProps) {
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
    if (!ctx) { try { host.removeChild(canvas); } catch { /* noop */ } return; }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 1, h = 1;
    let cols = 0;
    let drops: number[] = [];
    let rafId = 0, lastFrame = 0;

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / FONT_PX);
      drops = new Array(cols).fill(0).map(() => Math.random() * (h / FONT_PX));
      ctx.fillStyle = "#020402";
      ctx.fillRect(0, 0, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const start = performance.now();

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Translucent black overlay creates the phosphor trail.
      ctx.fillStyle = "rgba(2, 4, 2, 0.16)";
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${FONT_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      // Disable shadowBlur during stream body (cheap), only enable for heads.
      ctx.shadowColor = "rgba(0, 255, 120, 0.65)";

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
        const x = i * FONT_PX;
        const y = drops[i] * FONT_PX;

        // Head glyph — bright white-green with a halo.
        ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(190, 255, 200, 0.98)";
        ctx.fillText(ch, x, y);
        ctx.shadowBlur = 0;

        // Trail glyph one step up — classic phosphor green.
        ctx.fillStyle = "rgba(0, 255, 102, 0.55)";
        ctx.fillText(ch, x, y - FONT_PX);

        if (y > h && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }

      // --- Boot overlay (only during the first BOOT_TOTAL_MS) ---------------
      const elapsed = now - start;
      if (elapsed < BOOT_TOTAL_MS) {
        const linesShown = Math.min(BOOT_LINES.length, Math.floor(elapsed / BOOT_PER_LINE_MS) + 1);
        const fadeStart = BOOT_TOTAL_MS - BOOT_FADE_OUT_MS;
        const alpha = elapsed < fadeStart
          ? 1
          : Math.max(0, 1 - (elapsed - fadeStart) / BOOT_FADE_OUT_MS);
        ctx.save();
        ctx.font = `${FONT_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textBaseline = "top";
        const blockH = linesShown * (FONT_PX + 4);
        const startY = Math.max(20, (h - blockH) / 2 - 40);
        const startX = Math.max(16, w * 0.08);
        ctx.shadowColor = "rgba(120, 255, 160, 0.5)";
        ctx.shadowBlur = 4;
        for (let i = 0; i < linesShown; i++) {
          ctx.fillStyle = i === linesShown - 1
            ? `rgba(220, 255, 230, ${(0.95 * alpha).toFixed(3)})`
            : `rgba(140, 230, 170, ${(0.70 * alpha).toFixed(3)})`;
          ctx.fillText(BOOT_LINES[i], startX, startY + i * (FONT_PX + 4));
        }
        ctx.restore();
      }

      // --- Scanline overlay -------------------------------------------------
      // Sample every other line at low alpha — cheaper than per-pixel scan.
      ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      // Rare CRT flicker — once every ~60 frames.
      if (Math.random() < 1 / 60) {
        ctx.fillStyle = "rgba(0, 255, 102, 0.06)";
        ctx.fillRect(0, 0, w, h);
      }

      // CRT vignette — radial darker at corners.
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

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
