#!/usr/bin/env bun
// Replay the exact wheel/trackpad delta stream stored in a failed
// wheel-diagnostics.json artifact against the same long-note fixture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

const SUPPORTED_SCHEMA_VERSION = 1;

type Delta = { i?: number; dx: number; dy: number; t?: number };
type SelectionRangeFrame = {
  rangeCount: number;
  textLength: number;
  anchorOffset: number | null;
  focusOffset: number | null;
  signature: string;
};
type ObservedDelta = {
  i: number;
  dx: number;
  dy: number;
  sourceTimestampMs?: number;
  replayTimestampMs: number;
  before: number;
  after: number;
  waitMs: number;
  beforeRange: SelectionRangeFrame;
  afterRange: SelectionRangeFrame;
  stuck: boolean;
};
type WheelDiagnostics = {
  schemaVersion?: number;
  test?: string;
  project?: string;
  note?: { lineCount?: number };
  stuckFrame?: unknown;
  selectionStuckFrame?: SelectionDragSample | null;
  replay?: Delta[];
  wheelSamples?: Array<Delta & { before?: number; after?: number }>;
  selectionDragSamples?: SelectionDragSample[];
};

type SelectionDragSample = {
  i: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  t?: number;
};

function usage(): never {
  console.error("Usage: bun run scripts/replay-wheel-diagnostics.ts <wheel-diagnostics.json> [--project=chromium|firefox|webkit] [--retries=N] [--base-url=http://localhost:8080] [--out-dir=test-results/wheel-replay/<project>-r<retries>] [--trace=on|off] [--extra-traces] [--headed]");
  process.exit(2);
}

export function parseArgs(argv: string[]) {
  const project = process.env.PLAYWRIGHT_PROJECT ?? "chromium";
  const retries = process.env.RETRIES ?? "0";
  const args = {
    path: "",
    project,
    retries,
    baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    outDir: process.env.WHEEL_REPLAY_OUT_DIR ?? join(process.cwd(), "test-results", "wheel-replay", `${project}-r${retries}`),
    headed: process.env.HEADED === "1",
    trace: process.env.PLAYWRIGHT_TRACE !== "0",
    extraTraces: process.env.WHEEL_REPLAY_EXTRA_TRACES === "1",
  };
  let outDirSet = !!process.env.WHEEL_REPLAY_OUT_DIR;
  for (const a of argv) {
    if (a === "--headed") args.headed = true;
    else if (a === "--no-trace" || a === "--trace=off") args.trace = false;
    else if (a === "--trace=on") args.trace = true;
    else if (a === "--extra-traces" || a === "--trace-notes") args.extraTraces = true;
    else if (a.startsWith("--project=")) args.project = a.slice("--project=".length);
    else if (a.startsWith("--retries=")) args.retries = a.slice("--retries=".length);
    else if (a.startsWith("--base-url=")) args.baseUrl = a.slice("--base-url=".length).replace(/\/$/, "");
    else if (a.startsWith("--out-dir=")) { args.outDir = a.slice("--out-dir=".length); outDirSet = true; }
    else if (!args.path) args.path = a;
    else usage();
  }
  if (!args.path) usage();
  if (!outDirSet) args.outDir = join(process.cwd(), "test-results", "wheel-replay", `${args.project}-r${args.retries}`);
  return args;
}

export function preflightPlaywrightBrowser(browserType: BrowserType, project: string): void {
  try {
    const exe = browserType.executablePath();
    if (!exe || !existsSync(exe)) throw new Error(`missing binary at ${exe || "<unknown>"}`);
  } catch (e) {
    const install = `bunx playwright install --with-deps ${project}`;
    console.error(`✖ Playwright ${project} browser is not installed (${e instanceof Error ? e.message : String(e)}).`);
    console.error(`  Install it with:\n    ${install}`);
    process.exit(3);
  }
}

function getDeltas(diagnostics: WheelDiagnostics): Delta[] {
  return diagnostics.replay ?? diagnostics.wheelSamples?.map(({ i, dx, dy, t }) => ({ i, dx, dy, t })) ?? [];
}

async function seedLongNote(page: import("playwright").Page, lineCount: number) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `html,body,*{scroll-behavior:auto !important} html{zoom:1 !important}`;
    (document.head || document.documentElement).appendChild(style);
  });
  await page.goto("/wheel-scroll-e2e");
  const scroller = page.locator(".cm-scroller").first();
  await scroller.waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate((n) => {
    const el = document.querySelector<HTMLElement>(".cm-content");
    const view = (el as unknown as { cmView?: { view?: unknown } })?.cmView?.view;
    const text = Array.from({ length: n }, (_, i) => `line ${i} lorem ipsum dolor sit amet consectetur adipiscing`).join("\n");
    if (view && typeof (view as { dispatch?: unknown }).dispatch === "function") {
      (view as { dispatch: (spec: unknown) => void; state: { doc: { length: number } } }).dispatch({
        changes: { from: 0, to: (view as { state: { doc: { length: number } } }).state.doc.length, insert: text },
      });
    } else if (el) {
      el.textContent = text;
    }
  }, lineCount);
  await page.waitForTimeout(200);
  return scroller;
}

async function getSelectionRangeFrame(page: import("playwright").Page): Promise<SelectionRangeFrame> {
  return page.evaluate(() => {
    const sel = window.getSelection();
    const textLength = sel?.toString().length ?? 0;
    const rangeCount = sel?.rangeCount ?? 0;
    const anchorOffset = sel?.anchorOffset ?? null;
    const focusOffset = sel?.focusOffset ?? null;
    const rangeParts: string[] = [];
    for (let i = 0; sel && i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      rangeParts.push(`${r.startOffset}:${r.endOffset}:${r.collapsed ? 1 : 0}`);
    }
    return {
      rangeCount, textLength, anchorOffset, focusOffset,
      signature: `${rangeCount}|${textLength}|${anchorOffset ?? "n"}|${focusOffset ?? "n"}|${rangeParts.join(",")}`,
    };
  });
}

function findStuckFrame(observed: ObservedDelta[]): ObservedDelta | null {
  return observed.find((o) => o.dy !== 0 && o.before === o.after) ?? null;
}

function selectionDidNotAdvance(before: SelectionRangeFrame, after: SelectionRangeFrame): boolean {
  return after.rangeCount > 0 && after.textLength > 0 && after.signature === before.signature;
}

export async function replayWheelDiagnostics(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!existsSync(args.path)) throw new Error(`diagnostics file not found: ${args.path}`);
  const diagnostics = JSON.parse(readFileSync(args.path, "utf8")) as WheelDiagnostics;
  if ((diagnostics.schemaVersion ?? 0) > SUPPORTED_SCHEMA_VERSION) {
    console.warn(`wheel-diagnostics schemaVersion ${diagnostics.schemaVersion} is newer than this replay script (${SUPPORTED_SCHEMA_VERSION}); replaying compatible fields only`);
  }
  const deltas = getDeltas(diagnostics);
  const selectionDeltas = diagnostics.selectionDragSamples ?? [];
  if (deltas.length === 0 && selectionDeltas.length === 0) {
    throw new Error("wheel-diagnostics.json contains no replay, wheelSamples, or selectionDragSamples deltas");
  }

  const browserTypes: Record<string, BrowserType> = { chromium, firefox, webkit };
  const browserType = browserTypes[args.project];
  if (!browserType) throw new Error(`unsupported project: ${args.project}`);
  preflightPlaywrightBrowser(browserType, args.project);

  mkdirSync(args.outDir, { recursive: true });
  const browser = await browserType.launch({ headless: !args.headed });
  const context = await browser.newContext({
    baseURL: args.baseUrl,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  if (args.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const scroller = await seedLongNote(page, diagnostics.note?.lineCount ?? 1_000);
  await scroller.evaluate((el, top) => { el.scrollTop = top; }, diagnostics.wheelSamples?.[0]?.before ?? 0);
  const box = await scroller.boundingBox();
  if (!box) throw new Error("scroller has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const observed: ObservedDelta[] = [];
  for (let idx = 0; idx < deltas.length; idx++) {
    const d = deltas[idx];
    const before = await scroller.evaluate((el) => el.scrollTop);
    const beforeRange = await getSelectionRangeFrame(page);
    await page.mouse.wheel(d.dx, d.dy);
    const nextT = deltas[idx + 1]?.t;
    const waitMs = d.t != null && nextT != null ? Math.max(0, Math.min(1_000, nextT - d.t)) : 40;
    await page.waitForTimeout(waitMs);
    const after = await scroller.evaluate((el) => el.scrollTop);
    const afterRange = await getSelectionRangeFrame(page);
    const row: ObservedDelta = {
      i: d.i ?? idx, dx: d.dx, dy: d.dy, sourceTimestampMs: d.t,
      replayTimestampMs: Date.now(), before, after, waitMs, beforeRange, afterRange,
      stuck: d.dy !== 0 && before === after,
    };
    observed.push(row);
    console.log(`[wheel-replay] #${row.i} dx=${row.dx} dy=${row.dy} scrollTop=${before}->${after}${row.stuck ? " STUCK" : ""} selection=${afterRange.signature}`);
  }

  const observedSelection: Array<SelectionDragSample & {
    replayTimestampMs: number;
    beforeScrollTop: number;
    afterScrollTop: number;
    beforeRange: SelectionRangeFrame;
    afterRange: SelectionRangeFrame;
    stuck: boolean;
  }> = [];
  if (selectionDeltas.length) {
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let idx = 0; idx < selectionDeltas.length; idx++) {
      const d = selectionDeltas[idx];
      const beforeScrollTop = await scroller.evaluate((el) => el.scrollTop);
      const beforeRange = await getSelectionRangeFrame(page);
      await page.mouse.move(d.x, d.y, { steps: 2 });
      const nextT = selectionDeltas[idx + 1]?.t;
      const waitMs = d.t != null && nextT != null ? Math.max(0, Math.min(1_000, nextT - d.t)) : 30;
      await page.waitForTimeout(waitMs);
      const afterScrollTop = await scroller.evaluate((el) => el.scrollTop);
      const afterRange = await getSelectionRangeFrame(page);
      const stuck = (d.dx !== 0 || d.dy !== 0) && selectionDidNotAdvance(beforeRange, afterRange);
      const row = { ...d, replayTimestampMs: Date.now(), beforeScrollTop, afterScrollTop, beforeRange, afterRange, stuck };
      observedSelection.push(row);
      console.log(`[selection-replay] #${d.i} dx=${d.dx} dy=${d.dy} scrollTop=${beforeScrollTop}->${afterScrollTop}${stuck ? " STUCK" : ""} selection=${afterRange.signature}`);
    }
    await page.mouse.up().catch(() => undefined);
  }

  const stuckFrame = findStuckFrame(observed);
  const selectionStuckFrame = observedSelection.find((o) => o.stuck) ?? null;
  const result = {
    source: args.path,
    schemaVersion: diagnostics.schemaVersion ?? 0,
    project: args.project,
    retries: args.retries,
    generatedAt: new Date().toISOString(),
    sourceStuckFrame: diagnostics.stuckFrame ?? null,
    sourceSelectionStuckFrame: diagnostics.selectionStuckFrame ?? null,
    stuckFrame,
    selectionStuckFrame,
    observed,
    observedSelection,
  };
  const resultPath = join(args.outDir, "replay-result.json");
  const jsonlPath = join(args.outDir, "wheel-deltas.jsonl");
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  writeFileSync(jsonlPath, observed.map((o) => JSON.stringify(o)).join("\n") + "\n");
  writeFileSync(join(args.outDir, "selection-frames.jsonl"), observedSelection.map((o) => JSON.stringify(o)).join("\n") + (observedSelection.length ? "\n" : ""));
  await scroller.screenshot({ path: join(args.outDir, "scroller.png") }).catch(() => undefined);
  const tracePath = join(args.outDir, "trace.zip");
  if (args.trace) await context.tracing.stop({ path: tracePath });
  await browser.close();

  if (args.extraTraces) {
    const retries = process.env.RETRIES ?? "0";
    const notesPath = join(args.outDir, "trace-notes.json");
    writeFileSync(notesPath, JSON.stringify({
      source: args.path, project: args.project, retries,
      generatedAt: result.generatedAt, stuckFrame, selectionStuckFrame,
      tracePath: args.trace ? tracePath : null,
      artifacts: ["replay-result.json", "wheel-deltas.jsonl", "selection-frames.jsonl", "scroller.png", args.trace ? "trace.zip" : null].filter(Boolean),
    }, null, 2));
    console.log(`wrote ${notesPath}`);
    if (args.trace && existsSync(tracePath)) {
      const perRetry = join(args.outDir, `trace-retry-${retries}.zip`);
      try { writeFileSync(perRetry, readFileSync(tracePath)); console.log(`wrote ${perRetry}`); } catch { /* ignore */ }
    }
  }


  console.log(`replayed ${observed.length} deltas from ${args.path}`);
  console.log(`wrote ${resultPath}`);
  console.log(`wrote ${jsonlPath}`);
  console.log(`wrote ${join(args.outDir, "selection-frames.jsonl")}`);
  console.log(`wrote ${join(args.outDir, "scroller.png")}`);
  if (args.trace) console.log(`wrote ${join(args.outDir, "trace.zip")}`);
  if (stuckFrame) console.log(`first stuck frame: #${stuckFrame.i} scrollTop=${stuckFrame.before}`);
  if (selectionStuckFrame) console.log(`first selection stuck frame: #${selectionStuckFrame.i} selection=${selectionStuckFrame.afterRange.signature}`);
  if (diagnostics.selectionStuckFrame && !selectionStuckFrame) console.log("source artifact contains selectionStuckFrame; replay did not reproduce it in this run");
  return 0;
}

if (import.meta.main) {
  replayWheelDiagnostics().then((code) => process.exit(code)).catch((e) => {
    try { mkdirSync(dirname(process.env.WHEEL_REPLAY_OUT_DIR ?? join(process.cwd(), "test-results", "wheel-replay")), { recursive: true }); } catch { /* ignore */ }
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}