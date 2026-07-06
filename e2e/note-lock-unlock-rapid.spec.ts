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
    // Track every write to the notes row and every sendBeacon fallback.
    const writes: { method: string; url: string; body: string | null }[] = [];
    const beacons: string[] = [];

    const isNoteWrite = (req: Request) => {
      const url = req.url();
      if (!/\/rest\/v1\/notes\b/.test(url)) return false;
      const m = req.method();
      return m === "PATCH" || m === "POST";
    };

    page.on("request", (req) => {
      if (isNoteWrite(req)) {
        writes.push({ method: req.method(), url: req.url(), body: req.postData() });
      }
    });

    await page.addInitScript(() => {
      const orig = navigator.sendBeacon?.bind(navigator);
      (window as unknown as { __beacons: string[] }).__beacons = [];
      if (orig) {
        navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
          (window as unknown as { __beacons: string[] }).__beacons.push(String(url));
          return orig(url, data);
        };
      }
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

    // No writes should have fired mid-toggle; guarded providers must swallow
    // pending saveSnapshot / flushBeacon calls when the mode no longer matches.
    expect(
      writes,
      `Unexpected notes writes during ${toggleWindow}ms rapid toggle window:\n` +
        JSON.stringify(writes, null, 2),
    ).toEqual([]);

    const beaconList = await page.evaluate(
      () => (window as unknown as { __beacons: string[] }).__beacons,
    );
    beacons.push(...beaconList.filter((u) => /\/rest\/v1\/notes\b/.test(u)));
    expect(beacons, "Unexpected sendBeacon writes during rapid toggle").toEqual([]);

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
