// Cung Hoàng Đạo (Zodiac Map) — fixed-grid celestial scene.
//
// 12 zodiacs are anchored to a responsive grid (4×3 landscape, 3×4 portrait)
// so nothing ever clips off the viewport. Each constellation breathes on its
// own sine phase (~[0.2, 0.8] opacity) — fully async, organic. Behind each
// figure sits a faint Unicode glyph watermark; below it, a mono label with
// the abbreviation and date range. Only the background dust + faint stars
// drift slowly; the zodiacs themselves are pinned.
//
// 30fps cap, `lightweight: true`, no pointer interaction.
import { useEffect, useRef } from "react";
import type { SceneProps } from "./registry";

const FRAME_MS = 1000 / 30;

const FAR_STARS = 220;
const MID_STARS = 110;
const DUST_COUNT = 30;
const BG_DRIFT_PX_PER_SEC = 1; // very slow ambient drift for bg layers only

interface Constellation {
  name: string;       // 3-letter abbreviation
  glyph: string;      // Unicode astrological symbol
  range: string;      // date range, DD/MM - DD/MM
  pts: [number, number][];
  edges: [number, number][];
}

// Hand-authored topologies, normalised to roughly [-0.5, 0.5] on both axes.
// Each is recentered on its centroid at runtime so the figure draws centered
// inside its grid cell regardless of authoring drift.
const ZODIAC_RAW: Constellation[] = [
  {
    name: "ARI", glyph: "♈", range: "21/3 - 19/4",
    // Crooked horn: Hamal → Sheratan → Mesarthim → 2 horn-curl stars
    pts: [[-0.45, 0.25], [-0.15, 0.05], [0.1, -0.1], [0.3, -0.25], [0.45, -0.15]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    name: "TAU", glyph: "♉", range: "20/4 - 20/5",
    // Hyades V (5 stars, Aldebaran at right tip) + two horns rising to ζ Tau & Elnath
    pts: [
      [-0.3, 0.2], [-0.12, 0.05], [0.0, -0.05], [0.15, 0.05], [0.3, 0.2],
      [-0.2, -0.15], [-0.35, -0.35],
      [0.25, -0.15], [0.4, -0.3], [0.45, -0.45],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [1, 5], [5, 6],
      [3, 7], [7, 8], [8, 9],
    ],
  },
  {
    name: "GEM", glyph: "♊", range: "21/5 - 21/6",
    // Castor (0-6) and Pollux (7-13): head, neck, two hands, waist, two feet each;
    // joined at hands (edge 3-9).
    pts: [
      [-0.32, -0.42], [-0.32, -0.25], [-0.48, -0.15], [-0.12, -0.1], [-0.32, 0.0], [-0.42, 0.32], [-0.22, 0.32],
      [0.32, -0.42], [0.32, -0.25], [0.12, -0.1], [0.48, -0.15], [0.32, 0.0], [0.22, 0.32], [0.42, 0.32],
    ],
    edges: [
      [0, 1], [1, 2], [1, 3], [1, 4], [4, 5], [4, 6],
      [7, 8], [8, 9], [8, 10], [8, 11], [11, 12], [11, 13],
      [3, 9],
    ],
  },
  {
    name: "CNC", glyph: "♋", range: "22/6 - 22/7",
    // Small central body (Asellus Borealis/Australis + Acubens) with two claw legs and a tail
    pts: [
      [-0.4, -0.4], [0.4, -0.4],
      [-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1],
      [0.0, 0.4],
    ],
    edges: [[2, 3], [3, 5], [5, 4], [4, 2], [2, 0], [3, 1], [5, 6]],
  },
  {
    name: "LEO", glyph: "♌", range: "23/7 - 22/8",
    // Sickle (0..5, Regulus = 0) curving up and over, body quad, Denebola tail tip
    pts: [
      [-0.4, 0.15], [-0.42, 0.0], [-0.45, -0.15], [-0.38, -0.28], [-0.22, -0.32], [-0.12, -0.18],
      [-0.05, 0.0], [0.1, -0.1], [0.3, -0.05], [0.45, 0.05],
      [0.15, 0.2],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
      [5, 6], [6, 7], [7, 8], [8, 9], [8, 10], [10, 6],
    ],
  },
  {
    name: "VIR", glyph: "♍", range: "23/8 - 22/9",
    // Boxy torso + head + 2 arms + 2 legs, descending to Spica
    pts: [
      [-0.15, -0.15], [0.15, -0.15], [-0.15, 0.1], [0.15, 0.1],
      [0.0, -0.32],
      [-0.32, -0.05], [-0.45, 0.1],
      [0.32, -0.05], [0.45, 0.1],
      [-0.2, 0.28], [-0.25, 0.45],
      [0.2, 0.28],
      [0.05, 0.45],
    ],
    edges: [
      [0, 1], [1, 3], [3, 2], [2, 0],
      [4, 0], [4, 1],
      [0, 5], [5, 6],
      [1, 7], [7, 8],
      [2, 9], [9, 10],
      [3, 11], [11, 12],
    ],
  },
  {
    name: "LIB", glyph: "♎", range: "23/9 - 23/10",
    // Triangle (top apex + two scale pans) resting on a wider base; center beam
    pts: [
      [-0.45, 0.25], [0.45, 0.25],
      [-0.25, -0.05], [0.25, -0.05],
      [0.0, -0.32],
      [-0.05, 0.05], [0.05, 0.05],
    ],
    edges: [
      [0, 1],
      [0, 2], [1, 3],
      [2, 4], [4, 3],
      [2, 5], [5, 6], [6, 3],
      [4, 5], [4, 6],
    ],
  },
  {
    name: "SCO", glyph: "♏", range: "24/10 - 21/11",
    // Three claw stars → junction → Antares (heart) → body chain → curling tail → stinger
    pts: [
      [-0.45, -0.4], [-0.2, -0.42], [0.0, -0.35],
      [-0.25, -0.2],
      [-0.2, -0.05],
      [-0.15, 0.1], [-0.05, 0.22], [0.1, 0.28],
      [0.25, 0.22], [0.38, 0.1], [0.45, -0.05],
      [0.4, -0.2], [0.28, -0.28], [0.15, -0.3],
      [0.05, -0.22],
    ],
    edges: [
      [0, 3], [1, 3], [2, 3],
      [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
      [10, 11], [11, 12], [12, 13], [13, 14],
    ],
  },
  {
    name: "SGR", glyph: "♐", range: "22/11 - 21/12",
    // Teapot: spout tip, lid, body quad, handle (two stars)
    pts: [
      [-0.45, 0.0],
      [-0.1, -0.3],
      [-0.25, -0.05], [0.15, -0.1], [-0.2, 0.2], [0.2, 0.2],
      [0.4, -0.05], [0.4, 0.15],
    ],
    edges: [
      [0, 2],
      [1, 2], [1, 3],
      [2, 3], [3, 5], [5, 4], [4, 2],
      [3, 6], [6, 7], [7, 5],
    ],
  },
  {
    name: "CAP", glyph: "♑", range: "22/12 - 19/1",
    // Distorted arrowhead: head triangle on left, tapering body to the right, with
    // an internal cross-strut for the sea-goat's spine
    pts: [
      [-0.45, -0.2], [-0.4, 0.05],
      [-0.2, -0.28], [0.05, -0.22], [0.28, -0.18], [0.45, 0.05],
      [0.3, 0.25], [0.05, 0.3], [-0.18, 0.27], [-0.38, 0.2],
      [-0.05, 0.0],
    ],
    edges: [
      [0, 2], [2, 3], [3, 4], [4, 5],
      [5, 6], [6, 7], [7, 8], [8, 9], [9, 1], [1, 0],
      [1, 10], [10, 4],
    ],
  },
  {
    name: "AQR", glyph: "♒", range: "20/1 - 18/2",
    // Jar (4-pt polygon up top), pour point, two parallel zig-zag water streams
    pts: [
      [-0.12, -0.42], [0.12, -0.42], [0.17, -0.22], [-0.17, -0.22],
      [0.0, -0.1],
      [-0.4, 0.02], [-0.18, 0.12], [0.05, 0.02], [0.28, 0.12],
      [-0.4, 0.28], [-0.18, 0.38], [0.05, 0.28], [0.28, 0.38],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [2, 4], [3, 4],
      [4, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
    ],
  },
  {
    name: "PSC", glyph: "♓", range: "19/2 - 20/3",
    // Western circlet (5-pt polygon, lower-left) + Eastern circlet (4-pt, upper-right)
    // joined by a wide V cord meeting at Alrescha (apex, index 9)
    pts: [
      [-0.45, 0.32], [-0.35, 0.18], [-0.2, 0.22], [-0.2, 0.4], [-0.4, 0.44],
      [0.28, -0.42], [0.45, -0.35], [0.4, -0.18], [0.25, -0.25],
      [0.0, 0.08],
      [-0.18, 0.15], [-0.3, 0.2],
      [0.08, -0.05], [0.18, -0.15], [0.24, -0.22],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 0],
      [5, 6], [6, 7], [7, 8], [8, 5],
      [9, 10], [10, 11], [11, 1],
      [9, 12], [12, 13], [13, 14], [14, 8],
    ],
  },
];

// Recenter every constellation on its centroid → guarantees the figure
// sits visually centred inside its cell.
const ZODIAC: Constellation[] = ZODIAC_RAW.map((c) => {
  const cx = c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length;
  const cy = c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length;
  return { ...c, pts: c.pts.map(([x, y]) => [x - cx, y - cy] as [number, number]) };
});

interface Star { x: number; y: number; a: number; phase: number; }
interface Dust { x: number; y: number; a: number; vx: number; vy: number; }

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
    let cols = 4, rows = 3;
    let cellW = 1, cellH = 1, cellMin = 1;
    let rafId = 0, lastFrame = 0;

    let farStars: Star[] = [];
    let midStars: Star[] = [];
    let dust: Dust[] = [];

    // Static layer — bg gradient + watermark glyphs + mono labels. Rebuilt
    // only on resize; blitted via drawImage each frame. Eliminates ~36 text
    // rasterisations per frame (12 glyphs + 24 labels), which is the
    // dominant cost on low-end devices.
    let staticLayer: HTMLCanvasElement | OffscreenCanvas | null = null;

    const buildStaticLayer = () => {
      const cw = Math.max(1, Math.floor(w * dpr));
      const ch = Math.max(1, Math.floor(h * dpr));
      const off = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(cw, ch)
        : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
      const sctx = (off as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
      if (!sctx) { staticLayer = null; return; }
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background gradient.
      const bg = sctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#06091a");
      bg.addColorStop(1, "#0c1530");
      sctx.fillStyle = bg;
      sctx.fillRect(0, 0, w, h);

      // Pre-render glyph watermarks + labels per cell at a fixed alpha. We
      // deliberately drop the subtle "breath" on text — its modulation is
      // imperceptible (~0.04..0.09 alpha) and not worth the per-frame cost.
      const glyphSize = Math.round(cellMin * 0.45);
      const scl = cellMin * 0.32;
      for (let i = 0; i < ZODIAC.length; i++) {
        const z = ZODIAC[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = (col + 0.5) * cellW;
        const cy = (row + 0.5) * cellH;

        sctx.fillStyle = "rgba(180, 200, 240, 0.065)";
        sctx.font = `${glyphSize}px "Apple Symbols", "Segoe UI Symbol", serif`;
        sctx.textAlign = "center";
        sctx.textBaseline = "middle";
        sctx.fillText(z.glyph, cx, cy);

        const labelY = cy + scl * 0.6;
        sctx.textBaseline = "top";
        sctx.fillStyle = "rgba(190, 210, 240, 0.42)";
        sctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        sctx.fillText(z.name, cx, labelY);
        sctx.fillStyle = "rgba(170, 200, 240, 0.32)";
        sctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        sctx.fillText(z.range, cx, labelY + 12);
      }
      staticLayer = off as HTMLCanvasElement;
    };

    const resize = () => {
      w = host.clientWidth || 1;
      h = host.clientHeight || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Landscape → 4×3, portrait → 3×4. 12 cells either way.
      if (w >= h) { cols = 4; rows = 3; }
      else        { cols = 3; rows = 4; }
      cellW = w / cols;
      cellH = h / rows;
      cellMin = Math.min(cellW, cellH);

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
      buildStaticLayer();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const wrapX = (x: number) => ((x % w) + w) % w;

    const tick = (now: number) => {
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // Blit cached background + watermark glyphs + labels in one drawImage.
      if (staticLayer) {
        ctx.drawImage(staticLayer as CanvasImageSource, 0, 0, w, h);
      } else {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, "#06091a");
        bg.addColorStop(1, "#0c1530");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }

      const tSec = now * 0.001;
      const bgDrift = tSec * BG_DRIFT_PX_PER_SEC;

      // --- Background layer 1: far stars ---
      for (const s of farStars) {
        const tw = 1 + 0.25 * Math.sin(tSec * 0.6 + s.phase);
        const a = Math.max(0, Math.min(1, s.a * tw));
        ctx.fillStyle = `rgba(219, 233, 255, ${a.toFixed(3)})`;
        ctx.fillRect(wrapX(s.x + bgDrift * 0.4), s.y, 1, 1);
      }

      // --- Background layer 2: mid stars ---
      for (const s of midStars) {
        const tw = 1 + 0.35 * Math.sin(tSec * 0.9 + s.phase);
        const a = Math.max(0, Math.min(1, s.a * tw));
        ctx.fillStyle = `rgba(225, 236, 255, ${a.toFixed(3)})`;
        const sz = 1 + (Math.sin(s.phase) > 0.3 ? 0.5 : 0);
        ctx.fillRect(wrapX(s.x + bgDrift * 0.55), s.y, sz, sz);
      }

      // --- Background layer 3: dust ---
      for (const d of dust) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x += w; else if (d.x > w) d.x -= w;
        if (d.y < 0) d.y += h; else if (d.y > h) d.y -= h;
        ctx.fillStyle = `rgba(180, 200, 240, ${d.a.toFixed(3)})`;
        ctx.fillRect(wrapX(d.x + bgDrift * 0.75), d.y, 1, 1);
      }

      // --- Zodiacs pinned to grid cells (dynamic edges + vertex stars only;
      //     watermark glyphs + labels are baked into the static layer). ---
      const scl = cellMin * 0.32;

      for (let i = 0; i < ZODIAC.length; i++) {
        const z = ZODIAC[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = (col + 0.5) * cellW;
        const cy = (row + 0.5) * cellH;

        // Async breathing in [0.2, 0.8]
        const period = 6 + (i % 5); // 6..10 s
        const phase = (i * 1.7) % (Math.PI * 2);
        const breath = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * (Math.PI * 2) / period + phase));

        // Screen-space star positions.
        const screenPts = z.pts.map(([lx, ly]) => ({ x: cx + lx * scl, y: cy + ly * scl }));

        // Edges with per-edge micro-twinkle layered under the breath.
        for (let ei = 0; ei < z.edges.length; ei++) {
          const [a, b] = z.edges[ei];
          const ph = (i * 7 + ei) * 0.91;
          const tw = 0.5 + 0.5 * Math.sin(tSec * 1.1 + ph);
          const alpha = (0.20 + tw * 0.30) * breath;
          ctx.lineWidth = 0.6 + tw * 0.4;
          ctx.strokeStyle = `rgba(170, 200, 240, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(screenPts[a].x, screenPts[a].y);
          ctx.lineTo(screenPts[b].x, screenPts[b].y);
          ctx.stroke();
        }

        // Vertex stars with halos.
        for (let vi = 0; vi < screenPts.length; vi++) {
          const sp = screenPts[vi];
          const ph = (i * 11 + vi) * 1.37;
          const micro = 0.5 + 0.5 * Math.sin(tSec * 0.6 + ph);
          const baseR = 1.6 + 0.5 * micro;
          const haloR = baseR * 4.5;
          const haloA = (0.30 + micro * 0.18) * breath;
          const halo = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, haloR);
          halo.addColorStop(0, `rgba(219, 233, 255, ${haloA.toFixed(3)})`);
          halo.addColorStop(1, "rgba(219, 233, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(235, 244, 255, ${(0.55 + breath * 0.35).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, baseR, 0, Math.PI * 2);
          ctx.fill();
        }
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
      style={{ pointerEvents: "none" }}
    />
  );
}
