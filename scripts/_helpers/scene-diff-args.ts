// Shared CLI helpers for the e2e wrapper scripts.
//
// Responsibilities:
//   * Parse repeated `--scene-diff <id|glob>=<ratio>` flags.
//   * Parse single `--chrome-diff <ratio>` flag (chrome screenshot threshold).
//   * Expand wildcard scene ids (e.g. `neon-*`) against the registry-derived
//     list of known scene ids.
//   * Validate that every literal `--scene-diff` id exists in the registry,
//     warning by default or failing under `--strict-scene-diff`.
//   * Fold all of it into the SCENE_DIFF_RATIOS + CHROME_DIFF_RATIO env vars
//     that e2e/helpers/pixel-diff.ts reads at test time.
//   * Persist wildcard → expanded-ids info to a sidecar file so the CI
//     summary can show reviewers *which* patterns expanded to *what*.
//
// Pre-existing SCENE_DIFF_RATIOS / CHROME_DIFF_RATIO env values are
// preserved unless explicitly overridden by a CLI flag.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Regex-extract the list of enabled scene ids from registry.ts.
 *  Mirrors the same parsing strategy used by the runner scripts so we
 *  never need to import the React-loaded module from Node. */
export function loadKnownSceneIds(): string[] {
  const registryPath = resolve("src/components/home/scenes/registry.ts");
  if (!existsSync(registryPath)) return [];
  const txt = readFileSync(registryPath, "utf8");
  const ids: string[] = [];
  for (const block of txt.split(/\{\s*\n/).slice(1)) {
    const id = block.match(/id:\s*["']([^"']+)["']/)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

function globToRegex(glob: string): RegExp {
  // Convert a glob like `neon-*` to /^neon-.*$/. Only `*` is supported.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function isGlob(s: string): boolean {
  return s.includes("*");
}

function parseExistingSceneEnv(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  const trimmed = raw.trim();
  if (!trimmed) return out;
  try {
    if (trimmed.startsWith("{")) {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^([^=]+)=([\d.]+)$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** One wildcard expansion entry. `pattern` is the raw user input (e.g.
 *  `neon-*`); `ids` is the registry ids it matched; `ratio` is the value
 *  applied to all of them. Surface this in the CI summary so reviewers
 *  can audit what the glob actually touched. */
export interface SceneDiffExpansion {
  pattern: string;
  ids: string[];
  ratio: number;
}

export interface ParsedDiffFlags {
  /** A new env map (shallow-copied + extended). Pass to spawnSync({env}). */
  env: NodeJS.ProcessEnv;
  /** Resolved per-scene overrides after wildcard expansion. */
  overrides: Record<string, number>;
  /** Global chrome screenshot override, if --chrome-diff was passed. */
  chromeDiff?: number;
  /** Literal `--scene-diff` ids that didn't match any registry id. */
  unknown: string[];
  /** Wildcard patterns the user passed and what they expanded to. */
  expansions: SceneDiffExpansion[];
}

/** Help text describing --scene-diff / --chrome-diff usage. Printed by
 *  runner scripts when the user passes `--help`. Kept here so both runner
 *  scripts surface identical examples (including the shell quoting that
 *  globs need to survive the shell). */
export const SCENE_DIFF_HELP = `
Pixel-diff threshold flags (forwarded to Playwright via env):

  --scene-diff <id|glob>=<ratio>   Per-scene maxDiffPixelRatio override for
                                   the masked scene layer / hit-test specs.
                                   Repeatable. Globs use \`*\`.

  --chrome-diff <ratio>            Override for the chrome screenshot
                                   threshold (Header + slug input + Recents).
                                   Independent axis from --scene-diff.

  --strict-scene-diff              Exit non-zero when a literal --scene-diff
                                   id (or a glob with zero matches) is not
                                   present in the scene registry. Default
                                   is to warn and continue.

Examples:

  # Loosen a single scene
  --scene-diff neon-vapor=0.05

  # Tighten chrome while keeping shader scenes loose
  --chrome-diff 0.015 --scene-diff "neon-*=0.05"

  # Tune a whole family (QUOTE the glob so the shell doesn't expand it)
  --scene-diff "ethereal-*=0.04" --scene-diff "obsidian-ink=0.012"

  # Fail loudly on a typo'd scene id during baseline updates
  --strict-scene-diff --scene-diff neon-vapr=0.05
`.trim();

/** Write a JSON sidecar describing wildcard expansions so ci-e2e-summary
 *  can render a "pattern → ids" section in the GitHub step summary.
 *  No-op when the path is unset or there are no expansions. */
export function writeSceneDiffExpansionsLog(
  expansions: SceneDiffExpansion[],
  path: string | undefined,
): void {
  if (!path || expansions.length === 0) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        { schema: "scene-diff-expansions/v1", expansions },
        null,
        2,
      ),
    );
  } catch (e) {
    console.warn(`[scene-diff] failed to write expansions log to ${path}: ${(e as Error).message}`);
  }
}

export function parseSceneDiffFlags(
  argv: string[],
  opts: { knownSceneIds?: string[]; strict?: boolean } = {},
): ParsedDiffFlags {
  const known = opts.knownSceneIds ?? loadKnownSceneIds();
  const strict = opts.strict ?? argv.includes("--strict-scene-diff");

  const overrides: Record<string, number> = parseExistingSceneEnv(
    process.env.SCENE_DIFF_RATIOS,
  );
  const unknown: string[] = [];
  const expansions: SceneDiffExpansion[] = [];
  let chromeDiff: number | undefined;

  // Seed chrome diff from env so we don't drop pre-set values.
  const envChrome = process.env.CHROME_DIFF_RATIO;
  if (envChrome !== undefined && envChrome !== "") {
    const n = Number(envChrome);
    if (Number.isFinite(n) && n >= 0) chromeDiff = n;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chrome-diff") {
      const value = argv[i + 1];
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n < 0) {
        console.warn(`[scene-diff] ignoring invalid --chrome-diff value: ${value}`);
        continue;
      }
      chromeDiff = n;
      continue;
    }
    if (arg !== "--scene-diff") continue;
    const value = argv[i + 1];
    if (!value) continue;
    const m = value.match(/^([^=]+)=([\d.]+)$/);
    if (!m) {
      console.warn(`[scene-diff] ignoring malformed flag value: ${value} (expected id=ratio)`);
      continue;
    }
    const pattern = m[1];
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n < 0) {
      console.warn(`[scene-diff] ignoring non-numeric ratio: ${value}`);
      continue;
    }
    if (isGlob(pattern)) {
      const re = globToRegex(pattern);
      const matches = known.filter((id) => re.test(id));
      if (matches.length === 0) {
        const msg = `[scene-diff] pattern "${pattern}" matched no scenes in registry`;
        if (strict) {
          console.error(msg);
          process.exit(2);
        }
        console.warn(msg);
        unknown.push(pattern);
        continue;
      }
      for (const id of matches) overrides[id] = n;
      expansions.push({ pattern, ids: matches, ratio: n });
    } else {
      if (known.length > 0 && !known.includes(pattern)) {
        const msg = `[scene-diff] unknown scene id "${pattern}" (not in registry: ${known.join(", ")})`;
        if (strict) {
          console.error(msg);
          process.exit(2);
        }
        console.warn(msg);
        unknown.push(pattern);
        // Still record it — a typo will surface as "no effect" rather than
        // a silent application to the wrong scene.
        continue;
      }
      overrides[pattern] = n;
    }
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (Object.keys(overrides).length > 0) {
    env.SCENE_DIFF_RATIOS = JSON.stringify(overrides);
  }
  if (chromeDiff !== undefined) {
    env.CHROME_DIFF_RATIO = String(chromeDiff);
  }
  return { env, overrides, chromeDiff, unknown, expansions };
}
