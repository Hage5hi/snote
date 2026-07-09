// E2E: simulate many PWA-update reloads and confirm the note URL (both what
// the user sees and what the sanitizer would persist) keeps ONLY whitelisted
// query params. Cache-busting params like `?v=`, `?ver=`, `?t=`, `?cb=` must
// never survive across updates.
//
// PWA update = a full navigation to the same route, potentially with cache-
// buster query added by the SW / update-check code. We model that by looping
// N reloads to the same path with rotating cache-buster values and asserting
// invariants each iteration.
import { expect, test } from "@playwright/test";

const ITERATIONS = 8;
const NOTE_PATH = "/my-note";
const WHITELIST = ["foo", "tag", "q", "page"];

function buildBustedUrl(i: number): string {
  const params = new URLSearchParams({
    foo: "bar",           // whitelisted → survives
    tag: "todo",          // whitelisted → survives
    v: String(i),         // cache-buster → stripped
    ver: `2.${i}`,        // cache-buster → stripped
    t: String(Date.now() + i),
    cb: `pwa-${i}`,
    _: String(i),
  });
  return `${NOTE_PATH}?${params.toString()}`;
}

test("PWA update loop: URL keeps only whitelisted params, cache-busters stripped", async ({
  page,
}) => {
  const violations: Array<{ i: number; key: string; where: "console" | "location" }> = [];

  page.on("console", (msg) => {
    if (msg.type() !== "info") return;
    if (!msg.text().includes("[url-sanitize:event]")) return;
    Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)))
      .then((vals) => {
        const evt = vals[1] as { sanitized?: string } | null;
        if (!evt?.sanitized) return;
        const qs = evt.sanitized.split("?")[1] || "";
        for (const key of new URLSearchParams(qs).keys()) {
          if (!WHITELIST.includes(key)) {
            violations.push({ i: -1, key, where: "console" });
          }
        }
      })
      .catch(() => {});
  });

  for (let i = 0; i < ITERATIONS; i++) {
    await page.goto(buildBustedUrl(i));
    await expect(page.locator('[data-url-sanitize-debug-panel="true"]')).toBeVisible({
      timeout: 5_000,
    });

    // The sanitized event from the panel (source of truth for what would
    // be persisted) — read it via the DOM.
    const firstEvent = page.locator("[data-strip-event]").first();
    const sanitizedLine = (await firstEvent.textContent()) || "";
    const match = sanitizedLine.match(/sanitized:\s*(\S+)/);
    expect(match, `iteration ${i}: could not parse sanitized URL`).toBeTruthy();
    const sanitized = match![1];

    const qs = sanitized.split("?")[1] || "";
    const keys = [...new URLSearchParams(qs).keys()];
    for (const key of keys) {
      if (!WHITELIST.includes(key)) {
        violations.push({ i, key, where: "location" });
      }
    }

    // Explicit invariants: whitelisted survived, cache-busters gone.
    expect(qs, `iteration ${i}: foo missing`).toContain("foo=bar");
    expect(qs, `iteration ${i}: tag missing`).toContain("tag=todo");
    for (const bust of ["v=", "ver=", "t=", "cb=", "_="]) {
      expect(qs, `iteration ${i}: cache-buster ${bust} survived`).not.toContain(bust);
    }
  }

  expect(violations, `non-whitelisted keys leaked: ${JSON.stringify(violations)}`).toEqual([]);
});
