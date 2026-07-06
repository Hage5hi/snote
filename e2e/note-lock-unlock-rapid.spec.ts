// E2E: rapidly toggle lock/unlock via the URL hash and assert that
//   1. the seeded content is never corrupted, and
//   2. no upsert / beacon requests fire during the transition windows while
//      the Yjs provider is remounting (i.e. stale providers are guarded).
//
// This is the browser-level counterpart to the unit-level "stale provider
// blocked after mode flip" regression tests in
// src/lib/yjs/__tests__/provider.test.ts.

import { test, expect, type Request } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Rapid-toggle content — must never be corrupted.";

function uniqueSlug(): string {
  return `e2e-rapid-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

test.describe("rapid lock/unlock toggle via URL hash", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug();
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("no stale writes fire during remount; content stays decryptable", async ({
    page,
  }) => {
    // Track every mutating call to the notes endpoint — from BOTH the fetch
    // path (Supabase-js) and the sendBeacon fallback (unload flush). Any
    // background create/update fired mid-transition is considered a stale
    // write and fails the test.
    const writes: { source: string; method: string; url: string }[] = [];

    const isNoteWrite = (method: string, url: string) => {
      if (!/\/rest\/v1\/notes\b/.test(url)) return false;
      return method === "PATCH" || method === "POST" || method === "PUT";
    };

    page.on("request", (req: Request) => {
      if (isNoteWrite(req.method(), req.url())) {
        writes.push({ source: "fetch", method: req.method(), url: req.url() });
      }
    });

    // Wrap sendBeacon in-page and mirror to console so we capture even
    // synchronous unload-time writes. Also wrap fetch as a belt-and-braces
    // check in case a request bypasses Playwright's request event.
    await page.addInitScript(() => {
      const w = window as unknown as { __noteWrites: { source: string; method: string; url: string }[] };
      w.__noteWrites = [];
      const isNote = (u: string) => /\/rest\/v1\/notes\b/.test(u);
      const origBeacon = navigator.sendBeacon?.bind(navigator);
      if (origBeacon) {
        navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
          const u = String(url);
          if (isNote(u)) w.__noteWrites.push({ source: "beacon", method: "POST", url: u });
          return origBeacon(url, data);
        };
      }
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (isNote(url) && (method === "PATCH" || method === "POST" || method === "PUT")) {
          w.__noteWrites.push({ source: "fetch-wrap", method, url });
        }
        return origFetch(input as RequestInfo, init);
      };
    });

    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Lock it once through the UI so we have a valid hash to toggle with.
    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Now rapidly toggle the URL hash: encrypted → plaintext → encrypted …
    // Each hash change triggers the app to re-evaluate provider mode.
    // Reset the write log to only capture writes during the toggle window.
    writes.length = 0;
    const before = Date.now();
    for (let i = 0; i < 6; i++) {
      const withHash = i % 2 === 0;
      await page.evaluate(
        ({ slug, withHash, pass }) => {
          const next = withHash ? `/${slug}#${pass}` : `/${slug}`;
          window.location.hash = withHash ? `#${pass}` : "";
          // Force a full re-render path when clearing the hash.
          if (!withHash && window.location.hash) {
            history.replaceState(null, "", next);
          }
        },
        { slug, withHash, pass: PASSPHRASE },
      );
      // Tight loop — don't give the provider time to settle.
      await page.waitForTimeout(50);
    }
    const toggleWindow = Date.now() - before;

    // Collect in-page (fetch-wrap + beacon) captures and merge with the
    // Playwright network-level captures. No source may report any write.
    const inPage = await page.evaluate(
      () => (window as unknown as { __noteWrites: { source: string; method: string; url: string }[] }).__noteWrites,
    );
    const allWrites = [...writes, ...inPage];
    expect(
      allWrites,
      `Unexpected notes writes during ${toggleWindow}ms rapid toggle window:\n` +
        JSON.stringify(allWrites, null, 2),
    ).toEqual([]);

    // Land on the encrypted hash and confirm content still decrypts cleanly.
    await page.evaluate(
      ({ slug, pass }) => {
        window.location.href = `/${slug}#${pass}`;
      },
      { slug, pass: PASSPHRASE },
    );
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Full reload — content survived every toggle round.
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });

  test("editor blocks saves while Yjs provider is remounting", async ({ page }) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);

    // Throttle the upsert so the "remounting" state is observable.
    await page.route("**/rest/v1/notes**", async (route) => {
      await new Promise((r) => setTimeout(r, 750));
      await route.continue();
    });

    const confirm = page.getByRole("button", { name: /^encrypt$/i });
    await confirm.click();

    // The confirm button flips to a spinner (no accessible label) while the
    // upsert + provider remount is in flight — this is what stops the user
    // from re-submitting and enqueueing a stale write.
    await expect(confirm).toHaveCount(0, { timeout: 2_000 });

    // The editor itself becomes non-editable during the transition.
    await expect(page.locator(".cm-content[contenteditable='false']")).toHaveCount(
      1,
      { timeout: 2_000 },
    );

    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 20_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });
});
