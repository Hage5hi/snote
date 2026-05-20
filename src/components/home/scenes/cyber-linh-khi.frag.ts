// GLSL fragment shader for the "Cyber Linh Khí" scene.
// Simplex noise 2D + domain warping for slow turbulence, blended with a
// cyan/jade gradient and bottom-up glow. Tuned for visual quality at 30fps.
//
// Kept as a TS-exported string so Vite bundles it into the scene chunk and
// avoids extra HTTP requests / GLSL loaders.
export const CYBER_LINH_KHI_FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_isDark;   // 1.0 dark, 0.0 light

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

// Two octaves with domain warp — cheap turbulence.
float turbulence(vec2 p, float t) {
  vec2 warp = vec2(snoise(p + t), snoise(p - t)) * 0.6;
  float n1 = snoise(p * 1.2 + warp);
  float n2 = snoise(p * 2.5 - warp * 1.4 + t * 0.3);
  return 0.6 * n1 + 0.4 * n2;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  float t = u_time;
  float n = turbulence(p * 1.4, t);
  // Remap from [-1,1] to [0,1] with soft contrast.
  float v = smoothstep(-0.7, 0.9, n);

  // Jade → cyan palette.
  vec3 deep  = vec3(0.012, 0.067, 0.060);  // #03110f
  vec3 jade  = vec3(0.078, 0.722, 0.651);  // #14b8a6
  vec3 mint  = vec3(0.369, 0.918, 0.831);  // #5eead4

  vec3 col = mix(deep, jade, v);
  col = mix(col, mint, smoothstep(0.55, 0.95, v) * 0.7);

  // Bottom-up glow, stronger in dark mode.
  float glow = pow(1.0 - uv.y, 2.2) * 0.35;
  col += jade * glow;

  // Vignette so center text stays legible.
  float vig = smoothstep(1.05, 0.35, length(p));
  col *= mix(0.55, 1.0, vig);

  // Light theme: soft tinted wash so the shader stays visible against light bg.
  if (u_isDark < 0.5) {
    col = mix(vec3(0.94, 0.99, 0.98), col * 1.2, 0.55);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export const CYBER_LINH_KHI_VERT = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
