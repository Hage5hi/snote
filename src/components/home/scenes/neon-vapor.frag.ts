// Neon Vapor — vaporwave skyline v2.
//
// Procedural deep-purple → magenta → cyan sky with a hot horizon "sun",
// retro perspective grid floor below the horizon, drifting noise haze, and
// a soft CRT scanline overlay with light chromatic aberration at the edges.
// Single fragment pass, no textures, no loops.

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
  float aspect = u_resolution.x / u_resolution.y;

  // Horizon is at y=0.42. Above = sky, below = grid floor.
  float horizonY = 0.42;
  float aboveHorizon = step(horizonY, uv.y);

  // --- SKY ------------------------------------------------------------------
  // Deep purple base graded up to soft pink near the top.
  vec3 deepPurple = vec3(0.102, 0.020, 0.200); // #1a0533
  vec3 midnight   = vec3(0.054, 0.012, 0.137); // ~#0e0223
  vec3 hotPink    = vec3(1.000, 0.180, 0.575); // #ff2e93
  vec3 cyan       = vec3(0.000, 0.851, 1.000); // #00d9ff
  vec3 softPink   = vec3(1.000, 0.702, 0.851); // #ffb3d9

  float skyT = smoothstep(horizonY, 1.0, uv.y);
  vec3 sky = mix(deepPurple, midnight, skyT);

  // Drifting fog above the horizon.
  vec2 p = vec2(uv.x * aspect, uv.y);
  float n1 = fbm(p * 2.2 + vec2(u_time * 0.05, u_time * 0.03));
  sky = mix(sky, softPink * 0.5 + deepPurple * 0.5, n1 * 0.35 * skyT);

  // Horizon sun — a flat-topped half-disc with magenta→cyan gradient and a
  // few horizontal cut bands (classic synthwave sun).
  vec2 sunCenter = vec2(0.5, horizonY);
  vec2 sunUV = (uv - sunCenter) * vec2(aspect, 1.0);
  float sunR = length(sunUV) / 0.22;
  float sunMask = (1.0 - smoothstep(0.95, 1.05, sunR)) * step(horizonY, uv.y);
  vec3 sunGrad = mix(hotPink, cyan, smoothstep(0.0, 1.0, (uv.y - horizonY) / 0.18));
  // Horizontal cut bands — the further up, the thinner.
  float band = smoothstep(0.0, 0.04, abs(fract((uv.y - horizonY) * 22.0) - 0.5));
  // Bands only show on the lower half of the sun.
  float bandMask = smoothstep(0.20, 0.0, uv.y - horizonY);
  sunGrad *= mix(1.0, band, bandMask * 0.7);
  sky += sunGrad * sunMask * 1.05;

  // Bloom-ish halo around the sun.
  sky += hotPink * exp(-sunR * 2.8) * 0.35 * step(horizonY - 0.02, uv.y);

  // Sparse star pinpoints (high-noise threshold) in the upper sky.
  float starN = noise(p * 110.0);
  sky += vec3(1.0) * smoothstep(0.95, 1.0, starN) * skyT * 0.6;

  // --- GRID FLOOR -----------------------------------------------------------
  // Perspective-corrected XZ grid below horizon. y' grows as we approach
  // horizon, so the lines compress to a vanishing point.
  vec3 floorCol = vec3(0.0);
  if (uv.y < horizonY) {
    // Map to a virtual ground plane. Closer to horizon → larger z.
    float dy = max(horizonY - uv.y, 0.001);
    float z  = 0.10 / dy;                 // depth coord
    float x  = (uv.x - 0.5) * aspect * z; // perspective x

    // Distance to nearest grid line (with anti-aliasing).
    float gx = abs(fract(x * 4.0) - 0.5);
    float gz = abs(fract(z * 1.8 - u_time * 0.20) - 0.5);
    float fade = smoothstep(0.0, 0.5, dy);     // dim near vanishing point
    float lineX = smoothstep(0.06, 0.0, gx);
    float lineZ = smoothstep(0.06, 0.0, gz);
    float line  = max(lineX, lineZ);

    vec3 groundBase = mix(vec3(0.04, 0.005, 0.10), deepPurple, fade);
    vec3 lineCol    = mix(hotPink, cyan, smoothstep(0.0, 1.0, dy * 2.5));
    floorCol = groundBase + lineCol * line * fade * 0.9;

    // Soft horizon glow line.
    floorCol += hotPink * exp(-dy * 18.0) * 0.6;
  }

  vec3 col = mix(floorCol, sky, aboveHorizon);

  // --- POST: scanlines + chromatic aberration + bloom + vignette ------------
  // Subtle CRT scanlines.
  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159);
  col *= 0.93 + 0.07 * scan;

  // Chromatic aberration on the outer edges (cheap: weight R/B by radius).
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  col.r *= 1.0 + r2 * 0.35;
  col.b *= 1.0 + r2 * 0.25;

  // Pseudo-bloom: brighten the highlights without a real blur pass.
  col = pow(col, vec3(0.94));

  // Vignette.
  float vig = 1.0 - r2 * 0.9;
  col *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;
