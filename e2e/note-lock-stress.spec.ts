// E2E stress: rapidly toggle lock/unlock while also churning multiple URL
// hash segments (passphrase + arbitrary markers). After the storm, reload
// and verify the note still decrypts and is non-editable while locked.

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";
import { trackNoteWrites, uniqueSlug } from "./helpers/note-writes";

// Always retain traces/videos/screenshots for lock specs so flake triage
// never requires a re-run. Stable per-attempt artifact naming lives in CI.
test.use({ trace: "on", video: "on", screenshot: "only-on-failure" });

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Stress-toggle content — must stay decryptable.";

test.describe("stress: multi-segment hash churn", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug("stress");
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("survives hash churn; locked state remains non-editable", async ({
    page,
  }) => {
    const readWrites = await trackNoteWrites(page);

    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Establish locked baseline once through the UI.
    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Storm: 12 iterations swapping hash shape, markers, and passphrase
    // presence. Each write to location.hash triggers provider re-evaluation.
    for (let i = 0; i < 12; i++) {
      await page.evaluate(
        ({ slug, i, pass }) => {
          const shapes = [
            `#${pass}`,
            ``,
            `#${pass}&m=${i}`,
            `#foo=bar&${pass}`,
            `#${pass}&x=${i}&y=${i * 2}`,
            `#stale-${i}`,
          ];
          const next = `/${slug}${shapes[i % shapes.length]}`;
          history.replaceState(null, "", next);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
        { slug, i, pass: PASSPHRASE },
      );
      await page.waitForTimeout(30);
    }

    // Land on canonical encrypted URL, hard reload, verify decrypt.
    await page.evaluate(
      ({ slug, pass }) => {
        window.location.href = `/${slug}#${pass}`;
      },
      { slug, pass: PASSPHRASE },
    );
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Remove the passphrase → locked view must not be editable.
    await page.evaluate(
      ({ slug }) => {
        window.location.href = `/${slug}`;
      },
      { slug },
    );
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".cm-content[contenteditable='true']")).toHaveCount(
      0,
      { timeout: 10_000 },
    );

    // Sanity: at minimum the writes we saw were legitimate (not corrupt
    // payloads to some unexpected endpoint).
    const writes = await readWrites();
    for (const w of writes) {
      expect(w.url).toMatch(/\/rest\/v1\/notes/);
    }
  });
});
