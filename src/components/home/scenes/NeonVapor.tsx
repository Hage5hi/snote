// Neon Vapor — magenta/cyan vaporwave fog. OGL fragment shader.
// 30fps cap, pauses on hidden tab, no-ops on missing WebGL.
import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import type { SceneProps } from "./registry";
import { releaseWebGLContext } from "../SceneHost";
import { NEON_VAPOR_FRAG, NEON_VAPOR_VERT } from "./neon-vapor.frag";

const FRAME_MS = 1000 / 30;
const TIME_SCALE = 0.001;

export default function NeonVapor({ paused, onReady, signal }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (signal?.aborted) return;

    let renderer: Renderer | null = null;
    let program: Program | null = null;
    let mesh: Mesh | null = null;
    let rafId = 0, lastFrame = 0, lost = false;

    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        alpha: false,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(rafId);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const geometry = new Triangle(gl);
    program = new Program(gl, {
      vertex: NEON_VAPOR_VERT,
      fragment: NEON_VAPOR_FRAG,
      uniforms: {
        u_time: { value: 0 },
        u_resolution: { value: [1, 1] as [number, number] },
      },
    });
    mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer?.setSize(w, h);
      if (program) {
        program.uniforms.u_resolution.value = [
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
        ];
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const start = performance.now();
    const tick = (now: number) => {
      if (lost || signal?.aborted) return;
      if (pausedRef.current) { rafId = requestAnimationFrame(tick); return; }
      if (now - lastFrame < FRAME_MS) { rafId = requestAnimationFrame(tick); return; }
      lastFrame = now;
      if (program && mesh && renderer) {
        program.uniforms.u_time.value = (now - start) * TIME_SCALE;
        renderer.render({ scene: mesh });
        if (onReadyRef.current && !signal?.aborted) { onReadyRef.current(); onReadyRef.current = undefined; }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const onAbort = () => { cancelAnimationFrame(rafId); };
    signal?.addEventListener("abort", onAbort, { once: true });

    return () => {
      cancelAnimationFrame(rafId);
      signal?.removeEventListener("abort", onAbort);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      try { host.removeChild(canvas); } catch { /* noop */ }
      releaseWebGLContext(gl, canvas, "neon-vapor");
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
