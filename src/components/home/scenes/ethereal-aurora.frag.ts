// GLSL fragment shader — "Ethereal Aurora" v2.
//
// Three interweaving aurora ribbons with locked pastel palette
// (indigo/lavender/rose-mist/mint glow), a sparse static "star dust" layer
// for depth, and a faint teal horizon glow so the bottom edge feels like a
// real polar sky rather than a flat gradient.
//
// Dark-mode only; the registry pins next-themes to "dark" when active.
export const ETHEREAL_AURORA_FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_isDark; // parity only

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

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Curl-style ribbon: sine spine + fBm warp. Returns 0..1 ribbon intensity.
float ribbon(vec2 p, float yc, float thickness, float t, float wobble, float freq) {
  // Warped spine: vertical position drifts with noise over time.
  float w = snoise(vec2(p.x * 1.1 + wobble, t * 0.55 + wobble * 0.4)) * 0.28
          + snoise(vec2(p.x * 2.7 - wobble * 0.7, t * 0.32)) * 0.10;
  float spine = yc + sin(p.x * freq + t * 0.7 + wobble) * 0.06 + w;
  float d = abs(p.y - spine);
  // Soft gaussian falloff for feathered edge.
  return exp(-d * d / (2.0 * thickness * thickness));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  float t = u_time * 0.55;

  // Base: deep indigo at the top fading to a warmer plum lower down.
  vec3 baseTop = vec3(0.025, 0.012, 0.060); // ~#06031f
  vec3 baseBot = vec3(0.060, 0.030, 0.090); // ~#0f0d17 with violet
  vec3 base = mix(baseBot, baseTop, smoothstep(0.0, 1.0, uv.y));

  // Three locked-palette ribbons (top → bottom).
  float b1 = ribbon(p,  0.20, 0.22, t, 0.0, 1.3);
  float b2 = ribbon(p, -0.04, 0.18, t, 4.7, 1.8);
  float b3 = ribbon(p, -0.28, 0.26, t, 9.3, 1.0);

  vec3 lavender = vec3(0.718, 0.580, 0.957); // #b794f4
  vec3 rose     = vec3(0.984, 0.812, 0.906); // #fbcfe8
  vec3 mint     = vec3(0.655, 0.953, 0.816); // #a7f3d0
  vec3 indigo   = vec3(0.380, 0.275, 0.890); // #6147e3 highlight

  vec3 col = base;
  col += rose     * b1 * 0.55;
  col += lavender * b2 * 0.52;
  col += mint     * b3 * 0.46;
  // Indigo edge glow where ribbons overlap — gives interweave depth.
  col += indigo   * (b1 * b2 + b2 * b3) * 0.35;

  // Star dust — sparse pinpoints (~3% of pixels) twinkling very slowly.
  float starN = snoise(p * 38.0);
  float star = smoothstep(0.92, 1.00, starN);
  float twinkle = 0.6 + 0.4 * sin(t * 1.2 + starN * 11.0);
  col += vec3(0.95, 0.92, 1.00) * star * twinkle * 0.55;

  // Teal horizon glow — sells the polar-sky vibe.
  float horizon = exp(-pow((uv.y - 0.05) * 4.0, 2.0));
  col += vec3(0.20, 0.85, 0.78) * horizon * 0.10;

  // Vignette so centre copy is the brightest part of frame.
  float vig = smoothstep(1.20, 0.30, length(p));
  col *= mix(0.55, 1.0, vig);

  // Anti-banding dither.
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.006;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const ETHEREAL_AURORA_VERT = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
