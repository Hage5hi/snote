// GLSL fragment shader — "Cyber Linh Khí".
//
// Design intent: a DEEP near-black night with rare, soft jade/cyan fog
// drifting through a small portion of the canvas. Large slow blobs.
// The shader is only ever shown in dark mode (the theme switcher forces
// next-themes to "dark" when this scene is active), so we drop the light
// branch entirely.
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

// Single big-octave + gentle warp — large, slow shapes.
float bigFog(vec2 p, float t) {
  vec2 warp = vec2(snoise(p * 0.4 + t * 0.15),
                   snoise(p * 0.4 - t * 0.12)) * 0.35;
  return snoise(p * 0.55 + warp);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  float t = u_time * 0.45; // even slower

  float n = bigFog(p, t);

  // Tight smoothstep so jade only shows on the highest noise peaks
  // (~15–20% of pixels). Everything else stays near-black.
  float fog = smoothstep(0.45, 0.95, n);

  // Palette: deep midnight base, faint jade highlight.
  vec3 base = vec3(0.006, 0.012, 0.018); // ~#01030a
  vec3 jade = vec3(0.078, 0.722, 0.651); // #14b8a6

  // Cap jade intensity hard so it never overwhelms.
  vec3 col = base + jade * (fog * 0.35);

  // Subtle bottom-edge glow only.
  float glow = pow(max(0.0, 0.4 - uv.y), 2.0) * 0.18;
  col += jade * glow;

  // Strong vignette keeps center crisp + edges darker.
  float vig = smoothstep(1.15, 0.30, length(p));
  col *= mix(0.45, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const CYBER_LINH_KHI_VERT = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
