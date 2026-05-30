// Terminal Boot — phosphor-green matrix rain on a near-black CRT.
//
// Canvas2D, capped at 24fps, `lightweight: true` so it runs on low-end
// devices. Adds CRT details to the classic rain: blinking prompt cursor on
// the trailing column, a faint analogue scanline grid, head-glyph halo
// (drawn twice for cheap bloom), and an expanded glyph set (Katakana +
// Hangul + assorted CJK strokes).
//
// Pure aesthetic — no glyph carries meaning. Font lives inside the canvas
// so it never affects global typography.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 24;
const FONT_PX = 14;
const CURSOR_BLINK_MS = 530;
// Mixed scripts add visual variety without breaking the CRT mood.
const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロ" +
  "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ가나다라마바사아자카타파하" +
  "永和山川火水木金土日月星明心人之大小中下上山林森" +
  "0123456789<>/*+-=#$@%&{}[]";

export default function TerminalBoot({ paused, onReady, signal }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (signal?.aborted) return;

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
    const lastChar: string[] = [];
    let scanlinePattern: CanvasPattern | null = null;

    const buildScanlines = () => {
      // 3px-tall pattern: 1px subtle dark line + 2px transparent.
      // Plus a 2px-wide vertical hint stacked via separate draws (cheap).
      const p = document.createElement("canvas");
      p.width = 1; p.height = 3;
      const pctx = p.getContext("2d");
      if (!pctx) return;
      pctx.fillStyle = "rgba(0, 0, 0, 0.18)";
      pctx.fillRect(0, 0, 1, 1);
      scanlinePattern = ctx.createPattern(p, "repeat");
    };

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / FONT_PX);
      drops = new Array(cols).fill(0).map(() => Math.random() * (h / FONT_PX));
      lastChar.length = cols;
      // Prime the background.
      ctx.fillStyle = "#020402";
      ctx.fillRect(0, 0, w, h);
      buildScanlines();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const tick = (now: number) => {
      if (signal?.aborted) return;
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Translucent overlay creates the phosphor decay trail.
      ctx.fillStyle = "rgba(2, 4, 2, 0.16)";
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${FONT_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      // Track the rightmost column we just touched — the blinking cursor
      // anchors near a recently active stream.
      let cursorCol = -1;
      let cursorRow = -1;

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
        lastChar[i] = ch;
        const x = i * FONT_PX;
        const y = drops[i] * FONT_PX;

        // Head glow: double-draw the lead glyph with shadowBlur for cheap bloom.
        ctx.shadowColor = "rgba(190, 255, 200, 0.85)";
        ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(190, 255, 200, 0.95)";
        ctx.fillText(ch, x, y);
        // Second pass — pure halo, no shadow, additive-ish via low alpha.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(190, 255, 200, 0.30)";
        ctx.fillText(ch, x, y);

        // Trail glyph — classic phosphor green.
        ctx.fillStyle = "rgba(0, 255, 102, 0.55)";
        ctx.fillText(ch, x, y - FONT_PX);

        // Track a column near the right edge for the cursor.
        if (i > cols - 6 && y > h * 0.4 && y < h * 0.92) {
          cursorCol = i;
          cursorRow = Math.floor(drops[i]);
        }

        if (y > h && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }

      // Blinking prompt cursor — a phosphor block on the trailing column.
      if (cursorCol >= 0) {
        const blink = Math.floor(now / CURSOR_BLINK_MS) % 2 === 0;
        if (blink) {
          ctx.shadowColor = "rgba(190, 255, 200, 0.9)";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "rgba(190, 255, 200, 0.95)";
          ctx.fillRect(cursorCol * FONT_PX, cursorRow * FONT_PX + 2, FONT_PX - 2, FONT_PX - 3);
          ctx.shadowBlur = 0;
        }
      }

      // CRT analogue scanline grid overlay.
      if (scanlinePattern) {
        ctx.fillStyle = scanlinePattern;
        ctx.fillRect(0, 0, w, h);
      }
      // Vertical faint hint — separates the "phosphor cells".
      ctx.strokeStyle = "rgba(0, 0, 0, 0.10)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += FONT_PX) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }

      // Soft vignette to round the CRT corners.
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.35,
                                            w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
      vig.addColorStop(0, "rgba(0, 0, 0, 0)");
      vig.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      if (onReadyRef.current && !signal?.aborted) { onReadyRef.current(); onReadyRef.current = undefined; }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const onAbort = () => { cancelAnimationFrame(rafId); };
    signal?.addEventListener("abort", onAbort, { once: true });

    return () => {
      cancelAnimationFrame(rafId);
      signal?.removeEventListener("abort", onAbort);
      ro.disconnect();
      try { host.removeChild(canvas); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}
