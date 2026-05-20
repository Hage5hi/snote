// Cyber Linh Khí — slow cyan/jade fog driven by 2D simplex noise.
// OGL + fragment shader. Throttled to ~30fps, paused on tab hidden,
// graceful no-op when WebGL is unavailable or context is lost.
import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import type { SceneProps } from "./registry";
import { CYBER_LINH_KHI_FRAG, CYBER_LINH_KHI_VERT } from "./cyber-linh-khi.frag";

const FRAME_MS = 1000 / 30; // 30fps target
const TIME_SCALE = 0.0008;  // "u_time * tiny" — very slow turbulence

export default function CyberLinhKhi({ paused, isDark }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

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
      // No WebGL — silently no-op. Host div stays empty (transparent).
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
      vertex: CYBER_LINH_KHI_VERT,
      fragment: CYBER_LINH_KHI_FRAG,
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
      // OGL doesn't ship an explicit dispose; force context loss to free GPU.
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full motion-safe:animate-[fade-in_700ms_ease-out]"
    />
  );
}
