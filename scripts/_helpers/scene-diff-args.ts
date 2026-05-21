// Shared CLI helpers for the e2e wrapper scripts.
//
// `parseSceneDiffFlags` collects repeated `--scene-diff <id>=<ratio>` args
// and folds them into the SCENE_DIFF_RATIOS env var that
// e2e/helpers/pixel-diff.ts reads at test time. Existing SCENE_DIFF_RATIOS
// values are preserved unless explicitly overridden.

export function parseSceneDiffFlags(argv: string[]): {
  /** A new env map (shallow-copied + extended). Pass to spawnSync({env}). */
  env: NodeJS.ProcessEnv;
  /** Just the overrides, useful for logging. */
  overrides: Record<string, number>;
} {
  const overrides: Record<string, number> = {};
  // Seed from existing env so we don't accidentally drop CI-set values.
  const existing = process.env.SCENE_DIFF_RATIOS;
  if (existing) {
    try {
      if (existing.trim().startsWith("{")) {
        const obj = JSON.parse(existing) as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
          const n = Number(v);
          if (Number.isFinite(n)) overrides[k] = n;
        }
      } else {
        for (const part of existing.split(/[,\s]+/).filter(Boolean)) {
          const m = part.match(/^([^=]+)=([\d.]+)$/);
          if (m) overrides[m[1]] = Number(m[2]);
        }
      }
    } catch {
      // ignore malformed env — CLI flags will take over
    }
  }

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--scene-diff") continue;
    const value = argv[i + 1];
    if (!value) continue;
    const m = value.match(/^([^=]+)=([\d.]+)$/);
    if (!m) {
      console.warn(`[scene-diff] ignoring malformed flag value: ${value} (expected id=ratio)`);
      continue;
    }
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n < 0) {
      console.warn(`[scene-diff] ignoring non-numeric ratio: ${value}`);
      continue;
    }
    overrides[m[1]] = n;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (Object.keys(overrides).length > 0) {
    env.SCENE_DIFF_RATIOS = JSON.stringify(overrides);
  }
  return { env, overrides };
}
