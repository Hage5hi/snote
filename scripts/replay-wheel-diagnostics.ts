#!/usr/bin/env bun
// Replay the exact wheel/trackpad delta stream stored in a failed
// wheel-diagnostics.json artifact against the same long-note fixture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

const SUPPORTED_SCHEMA_VERSION = 1;

type Delta = { i?: number; dx: number; dy: number; t?: number };
type WheelDiagnostics = {
  schemaVersion?: number;
  test?: string;
  project?: string;
  note?: { lineCount?: number };
  replay?: Delta[];
  wheelSamples?: Array<Delta & { before?: number; after?: number }>;
};

function usage(): never {
  console.error("Usage: bun run scripts/replay-wheel-diagnostics.ts <wheel-diagnostics.json> [--project=chromium|firefox|webkit] [--base-url=http://localhost:8080] [--headed]");
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = { path: "", project: process.env.PLAYWRIGHT_PROJECT ?? "chromium", baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080", headed: process.env.HEADED === "1" };
  for (const a of argv) {
    if (a === "--headed") args.headed = true;
    else if (a.startsWith("--project=")) args.project = a.slice("--project=".length);
    else if (a.startsWith("--base-url=")) args.baseUrl = a.slice("--base-url=".length).replace(/\/$/, "");
    else if (!args.path) args.path = a;
    else usage();
  }
  if (!args.path) usage();
  return args;
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

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.path)) throw new Error(`diagnostics file not found: ${args.path}`);
const diagnostics = JSON.parse(readFileSync(args.path, "utf8")) as WheelDiagnostics;
if ((diagnostics.schemaVersion ?? 0) > SUPPORTED_SCHEMA_VERSION) {
  console.warn(`wheel-diagnostics schemaVersion ${diagnostics.schemaVersion} is newer than this replay script (${SUPPORTED_SCHEMA_VERSION}); replaying compatible fields only`);
}
const deltas = diagnostics.replay ?? diagnostics.wheelSamples?.map(({ i, dx, dy, t }) => ({ i, dx, dy, t })) ?? [];
if (deltas.length === 0) throw new Error("wheel-diagnostics.json contains no replay or wheelSamples deltas");

const browserTypes: Record<string, BrowserType> = { chromium, firefox, webkit };
const browserType = browserTypes[args.project];
if (!browserType) throw new Error(`unsupported project: ${args.project}`);

const browser = await browserType.launch({ headless: !args.headed });
const context = await browser.newContext({
  baseURL: args.baseUrl,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const scroller = await seedLongNote(page, diagnostics.note?.lineCount ?? 1_000);
await scroller.evaluate((el, top) => { el.scrollTop = top; }, diagnostics.wheelSamples?.[0]?.before ?? 0);
const box = await scroller.boundingBox();
if (!box) throw new Error("scroller has no bounding box");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

const observed: Array<{ i: number; dx: number; dy: number; before: number; after: number; waitMs: number }> = [];
for (let idx = 0; idx < deltas.length; idx++) {
  const d = deltas[idx];
  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(d.dx, d.dy);
  const nextT = deltas[idx + 1]?.t;
  const waitMs = d.t != null && nextT != null ? Math.max(0, Math.min(1_000, nextT - d.t)) : 40;
  await page.waitForTimeout(waitMs);
  const after = await scroller.evaluate((el) => el.scrollTop);
  observed.push({ i: d.i ?? idx, dx: d.dx, dy: d.dy, before, after, waitMs });
}

const outDir = join(process.cwd(), "test-results", "wheel-replay");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "replay-result.json"), JSON.stringify({ source: args.path, schemaVersion: diagnostics.schemaVersion ?? 0, project: args.project, observed }, null, 2));
await scroller.screenshot({ path: join(outDir, "scroller.png") }).catch(() => undefined);
console.log(`replayed ${observed.length} deltas from ${args.path}`);
console.log(`wrote ${join(outDir, "replay-result.json")}`);
await browser.close();