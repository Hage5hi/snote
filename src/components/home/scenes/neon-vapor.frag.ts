// Neon Vapor — magenta/cyan vaporwave fog. Two animated noise layers + a
// horizontal scanline. Cheap-ish fragment shader (no loops, no textures).

export const NEON_VAPOR_VERT = /* glsl */ `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const NEON_VAPOR_FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;

// Cheap hash + value noise.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  // Two drifting fog layers.
  float n1 = fbm(p * 2.2 + vec2(u_time * 0.06, u_time * 0.04));
  float n2 = fbm(p * 3.5 - vec2(u_time * 0.04, u_time * 0.07));

  // Magenta → cyan with a violet midtone.
  vec3 magenta = vec3(0.92, 0.27, 0.62);
  vec3 cyan    = vec3(0.25, 0.85, 0.95);
  vec3 violet  = vec3(0.38, 0.18, 0.58);

  // Vertical mix: bottom magenta → top cyan; modulated by noise.
  vec3 base = mix(magenta, cyan, smoothstep(0.0, 1.0, uv.y));
  base = mix(base, violet, 0.45);

  float fog = mix(n1, n2, 0.5);
  vec3 col = base * (0.35 + fog * 0.95);

  // Horizon glow band.
  float horizon = exp(-pow((uv.y - 0.42) * 4.5, 2.0));
  col += vec3(1.0, 0.55, 0.85) * horizon * 0.18;

  // Scanlines — subtle CRT vibe.
  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159);
  col *= 0.92 + 0.08 * scan;

  // Vignette towards the deep void.
  vec2 d = uv - 0.5;
  float vig = 1.0 - dot(d, d) * 0.85;
  col *= clamp(vig, 0.0, 1.0);

  // Final tone — slight gamma lift so darks aren't crushed on OLED.
  col = pow(col, vec3(0.92));

  gl_FragColor = vec4(col, 1.0);
}
`;
