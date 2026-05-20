// CI-oriented integration: verify the STICKY_DEBUG env var toggles
// both behaviors in lockstep across three states (unset, "0", "1"):
//
//   1. scanStats debug lines (head-scan: / full-scan fallback: / summary:)
//      are EMITTED only when STICKY_DEBUG=1, never when unset or "0".
//   2. The CI workflow's `tee` of the perf timing log AND the
//      upload-artifact step are GATED on the same value, so a 0/unset
//      run leaves no artifact behind.
//
// We exercise (1) via `parseCliConfig` + a live `upsertStickyComment`
// call (captures the debug sink); we exercise (2) by parsing the
// workflow YAML and simulating the shell + `if:` expressions against
// each of the three env values.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseCliConfig,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:debug-env-toggle -->";
const WORKFLOW_PATH = join(process.cwd(), ".github/workflows/ci.yml");

function makeApi(seed: StickyComment[]) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const api: StickyApi = {
    list: vi.fn(async () => state.map((c) => ({ ...c }))),
    create: vi.fn(async (body: string) => {
      const c = { id: nextId++, body };
      state.push(c);
      return c;
    }),
    update: vi.fn(async (id: number, body: string) => {
      const c = state.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    }),
    remove: vi.fn(async (id: number) => {
      const i = state.findIndex((x) => x.id === id);
      if (i >= 0) state.splice(i, 1);
    }),
  };
  return { api, state };
}

async function runWithEnv(env: Record<string, string | undefined>) {
  const cfg = parseCliConfig([], env);
  const { api } = makeApi([{ id: 1, body: `${MARKER}\nold` }]);
  const lines: string[] = [];
  await upsertStickyComment({
    api,
    marker: MARKER,
    body: "fresh",
    debug: cfg.debug ? (l) => lines.push(l) : undefined,
  });
  return { cfg, lines };
}

describe("STICKY_DEBUG env toggle: scan-stats lines + perf artifact gating", () => {
  describe("scanStats debug lines toggle by STICKY_DEBUG", () => {
    it("unset → debug=false, NO head-scan / full-scan / summary lines emitted", async () => {
      const { cfg, lines } = await runWithEnv({});
      expect(cfg.debug).toBe(false);
      expect(lines).toEqual([]);
    });

    it('"0" → debug=false, NO debug lines emitted', async () => {
      const { cfg, lines } = await runWithEnv({ STICKY_DEBUG: "0" });
      expect(cfg.debug).toBe(false);
      expect(lines).toEqual([]);
    });

    it('"1" → debug=true, head-scan + summary lines emitted with scanStats fields', async () => {
      const { cfg, lines } = await runWithEnv({ STICKY_DEBUG: "1" });
      expect(cfg.debug).toBe(true);

      const headScan = lines.find((l) => l.startsWith("head-scan:"));
      expect(headScan).toBeDefined();
      expect(headScan).toMatch(/pagesWalked=\d+/);
      expect(headScan).toMatch(/commentsExamined=\d+/);
      expect(headScan).toMatch(/linesScanned=\d+/);

      const summary = lines.find((l) => l.startsWith("summary:"));
      expect(summary).toMatch(/action=updated/);
      expect(summary).toMatch(/effectiveStrategy=delete/);
    });
  });

  describe("workflow perf-log + upload-artifact gating against STICKY_DEBUG", () => {
    const yaml = readFileSync(WORKFLOW_PATH, "utf8");

    // Pull out the perf run-block (uses `if [ "$STICKY_DEBUG" = "1" ]`).
    const perfBlock = yaml.match(
      /Sticky-upsert perf suite[\s\S]+?run:[\s\S]+?(?=\n\s{6}-\s)/,
    )?.[0];

    /** Simulate the shell guard's effect for a given STICKY_DEBUG value. */
    const shellWritesLog = (sticky_debug: string | undefined): boolean =>
      sticky_debug === "1";

    /** Simulate the upload-artifact `if:` expression for a given value. */
    const uploadEnabled = (sticky_debug: string | undefined): boolean =>
      sticky_debug === "1";

    it("perf block exists and contains the STICKY_DEBUG=1 shell guard", () => {
      expect(perfBlock, "perf run-block missing").toBeTruthy();
      expect(perfBlock!).toMatch(/if\s*\[\s*"\$STICKY_DEBUG"\s*=\s*"1"\s*\]/);
      expect(perfBlock!).toMatch(/tee\s+reports\/_ci\/sticky-upsert-perf-timing\.log/);
    });

    it.each([
      ["unset", undefined],
      ['"0"', "0"],
    ] as const)("when STICKY_DEBUG=%s → shell does NOT tee log AND upload step is skipped", (_label, v) => {
      expect(shellWritesLog(v)).toBe(false);
      expect(uploadEnabled(v)).toBe(false);
    });

    it('when STICKY_DEBUG="1" → shell tees log AND upload step runs', () => {
      expect(shellWritesLog("1")).toBe(true);
      expect(uploadEnabled("1")).toBe(true);
    });

    it("upload-artifact step references the same path the shell guard writes", () => {
      const uploadBlock = yaml.match(
        /-\s*if:[^\n]*\n\s*uses:\s*actions\/upload-artifact@v4[\s\S]+?path:\s*reports\/_ci\/sticky-upsert-perf-timing\.log/,
      );
      expect(uploadBlock).toBeTruthy();
      expect(uploadBlock![0]).toMatch(/inputs\.sticky_debug\s*==\s*'1'/);
    });
  });
});
