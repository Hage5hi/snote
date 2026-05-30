// Ethereal Aurora — three drifting pastel light bands. OGL + fragment shader.
// Mirrors the CyberLinhKhi lifecycle exactly: ~30fps cap, pause on tab hidden,
// graceful no-op when WebGL is unavailable or the context is lost.
import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import type { SceneProps } from "./registry";
import { releaseWebGLContext } from "../SceneHost";
import { ETHEREAL_AURORA_FRAG, ETHEREAL_AURORA_VERT } from "./ethereal-aurora.frag";

const FRAME_MS = 1000 / 30;
const TIME_SCALE = 0.0005; // even slower than CyberLinhKhi — dreamier drift

export default function EtherealAurora({ paused, isDark, onReady }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: Renderer | null = null;
    let program: Program | null = null;
    let mesh: Mesh | null = null;
    let rafId = 0;
    let lastFrame = 0;
    let lost = false;

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
      vertex: ETHEREAL_AURORA_VERT,
      fragment: ETHEREAL_AURORA_FRAG,
      uniforms: {
        u_time: { value: 0 },
        u_resolution: { value: [1, 1] as [number, number] },
        u_isDark: { value: isDarkRef.current ? 1 : 0 },
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
      if (lost) return;
      if (pausedRef.current) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (now - lastFrame < FRAME_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      if (program && mesh && renderer) {
        program.uniforms.u_time.value = (now - start) * TIME_SCALE;
        program.uniforms.u_isDark.value = isDarkRef.current ? 1 : 0;
        renderer.render({ scene: mesh });
        if (onReadyRef.current) {
          onReadyRef.current();
          onReadyRef.current = undefined;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      try {
        host.removeChild(canvas);
      } catch {
        /* already detached */
      }
      releaseWebGLContext(gl, canvas, "ethereal-aurora");
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
