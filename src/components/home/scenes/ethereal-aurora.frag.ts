// GLSL fragment shader — "Cực Quang Mộng" (Ethereal Aurora).
//
// Slow-drifting pastel aurora veils blended via screen-blend on a near-black
// indigo base, with sparse twinkling stardust on top — dream-like ("mộng"),
// not party. Dark-only — ThemeToggle pins next-themes to "dark" when active.
export const ETHEREAL_AURORA_FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_isDark;

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

// Soft wide aurora veil — Gaussian falloff, generous width, gentle warp.
float veil(vec2 p, float yc, float s, float t, float wobble, float freq) {
  float warp = snoise(vec2(p.x * freq, t * 0.32 + wobble)) * 0.28;
  float warp2 = snoise(vec2(p.x * freq * 0.5 - 1.7, t * 0.18 + wobble)) * 0.10;
  float d = abs(p.y - yc - warp - warp2);
  return exp(-d * d / (2.0 * s * s));
}

// Cheap hash for stardust.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Desaturate slightly for ethereal feel.
vec3 desat(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(l), amt);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  float t = u_time * 0.32; // slow, dream drift.

  // Deep indigo base — slight purple gradient top→bottom.
  vec3 base = mix(vec3(0.024, 0.012, 0.045),    // top  #0a0518 → slightly lifted
                  vec3(0.012, 0.008, 0.028), uv.y); // bottom near-black

  // Three wide aurora veils, widely spaced, different frequencies.
  float v1 = veil(p, 0.22 + sin(t * 0.17) * 0.05, 0.30, t, 0.0, 1.10);
  float v2 = veil(p, -0.02 + cos(t * 0.13) * 0.06, 0.26, t, 4.7, 0.85);
  float v3 = veil(p, -0.30 + sin(t * 0.10 + 1.1) * 0.05, 0.34, t, 9.3, 1.30);

  // Desaturated pastels — closer to luminance for ethereal blend.
  vec3 rose   = desat(vec3(0.984, 0.812, 0.906), 0.20); // #fbcfe8
  vec3 violet = desat(vec3(0.655, 0.545, 0.980), 0.20); // #a78bfa
  vec3 mint   = desat(vec3(0.654, 0.952, 0.831), 0.20); // #a7f3d0
  vec3 sky    = desat(vec3(0.482, 0.910, 0.961), 0.20); // #7be7f5

  // Screen-blend the veils onto the base — colors melt into each other.
  vec3 col = base;
  vec3 layer1 = mix(rose,   sky,    smoothstep(-0.4, 0.4, p.x));
  vec3 layer2 = mix(violet, mint,   smoothstep(-0.3, 0.5, p.x + 0.1));
  vec3 layer3 = mix(sky,    violet, smoothstep(-0.5, 0.3, p.x - 0.1));

  // Screen blend: 1 - (1-a)(1-b)
  col = 1.0 - (1.0 - col) * (1.0 - layer1 * v1 * 0.55);
  col = 1.0 - (1.0 - col) * (1.0 - layer2 * v2 * 0.50);
  col = 1.0 - (1.0 - col) * (1.0 - layer3 * v3 * 0.45);

  // Stardust — sparse twinkling points, threshold gates to ~0.8% of pixels.
  vec2 gp = floor(p * 140.0);
  float h = hash(gp);
  if (h > 0.992) {
    float twinkle = sin(t * 1.5 + h * 6.2831) * 0.5 + 0.5;
    float intensity = (h - 0.992) / 0.008; // 0..1 within the threshold band
    col += vec3(1.0, 0.95, 1.0) * twinkle * intensity * 0.55;
  }

  // Soft bottom teal glow → cực quang chân trời.
  float glow = pow(max(0.0, 0.30 - uv.y), 2.0) * 0.16;
  col += mint * glow;

  // Vignette — center stays bright for hero copy, edges sink to indigo.
  float vig = smoothstep(1.25, 0.30, length(p));
  col *= mix(0.50, 1.0, vig);

  // Subtle blue-noise dither to kill banding on OLED.
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.015;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const ETHEREAL_AURORA_VERT = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
