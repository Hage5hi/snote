// GLSL fragment shader — "Cyber Linh Khí" v2.
//
// Deep near-black night with slow jade/cyan linh-khí currents. Compared to v1
// this version uses two-pass domain warping to bend fog into long flowing
// currents (vs. round blobs), adds a faint chromatic-shift highlight on the
// brightest peaks, and a static dither grain to kill OLED banding.
//
// Dark-mode only; the registry pins next-themes to "dark" when active.
export const CYBER_LINH_KHI_FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_isDark; // kept for API parity; ignored.

// --- Simplex noise (Ashima / Stefan Gustavson, public domain) ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                          + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                          dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Two-pass domain warp produces long flowing currents instead of round blobs.
float currentFog(vec2 p, float t) {
  vec2 w1 = vec2(snoise(p * 0.35 + t * 0.12),
                 snoise(p * 0.35 - t * 0.10)) * 0.55;
  vec2 w2 = vec2(snoise((p + w1) * 0.55 + t * 0.18),
                 snoise((p + w1) * 0.55 - t * 0.14)) * 0.35;
  return snoise((p + w2) * 0.7 + vec2(0.0, t * 0.05));
}

// Cheap hash for static dither — kills banding on OLED without rendering grain
// frame-by-frame (it stays put with the pixel position).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  float t = u_time * 0.40;
  float n = currentFog(p, t);

  // Tight window — jade only on the brightest 18% of pixels.
  float fog = smoothstep(0.42, 0.95, n);

  // Palette: deep midnight base, jade highlight + faint cyan rim.
  vec3 base = vec3(0.005, 0.011, 0.018); // ~#01030a
  vec3 jade = vec3(0.078, 0.722, 0.651); // #14b8a6
  vec3 cyan = vec3(0.376, 0.886, 0.831); // #5eead4

  // Sample neighbouring noise to fake a 1px chromatic split on the peaks —
  // gives the brightest fog a subtle jade->cyan gradient like wet stone.
  float nC = currentFog(p + vec2(0.004, 0.0), t);
  float fogC = smoothstep(0.42, 0.95, nC);

  vec3 col = base
    + jade * (fog  * 0.32)
    + cyan * (fogC * 0.18);

  // Slow drifting "ember motes" — six tiny pulses that float across the frame.
  // Position seeded by index so they keep their identity across frames.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(
      sin(t * 0.31 + fi * 1.7) * 0.55,
      cos(t * 0.27 + fi * 2.3) * 0.32
    );
    float d = length(p - c);
    float pulse = 0.5 + 0.5 * sin(t * 0.9 + fi * 1.3);
    col += jade * (exp(-d * 95.0) * (0.18 + 0.22 * pulse));
  }

  // Subtle bottom glow only.
  float glow = pow(max(0.0, 0.4 - uv.y), 2.0) * 0.18;
  col += jade * glow;

  // Vignette keeps centre crisp.
  float vig = smoothstep(1.20, 0.30, length(p));
  col *= mix(0.42, 1.0, vig);

  // Static dither grain — 1.5/255 amplitude is enough to break colour bands
  // on OLED without being perceptible as noise.
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.006;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const CYBER_LINH_KHI_VERT = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
