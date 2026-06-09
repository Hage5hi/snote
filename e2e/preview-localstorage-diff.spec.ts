// E2E: capture three localStorage snapshots (pre-migrate, post-migrate, after
// desktop→mobile→desktop toggle), compute the diff between them, attach it as
// a JSON artifact for easy triage, and assert the expected key changes:
//   - legacy `notes:preview-visible` must EXIST in all three snapshots
//   - `notes:preview-visible:wide` must be ADDED by migration
//   - viewport toggle must produce ZERO key changes
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_LEGACY = "notes:preview-visible";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

function notePath() {
  return `/e2e-ls-diff-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedLegacy(page: Page) {
  await page.addInitScript(
    ({ lang, ip, legacy, wide, narrow }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
      localStorage.removeItem(wide);
      localStorage.removeItem(narrow);
      localStorage.setItem(legacy, "1");
    },
    {
      lang: LANG_KEY,
      ip: IP_DETECTED_KEY,
      legacy: PREVIEW_LEGACY,
      wide: PREVIEW_WIDE,
      narrow: PREVIEW_NARROW,
    },
  );
}

type Snap = Record<string, string>;

async function snapshot(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out[k] = localStorage.getItem(k) ?? "";
    }
    return out;
  });
}

interface Diff {
  added: Record<string, string>;
  removed: Record<string, string>;
  changed: Record<string, { from: string; to: string }>;
  unchanged: string[];
}

function diff(a: Snap, b: Snap): Diff {
  const out: Diff = { added: {}, removed: {}, changed: {}, unchanged: [] };
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.added[k] = b[k];
    else if (a[k] !== b[k]) out.changed[k] = { from: a[k], to: b[k] };
    else out.unchanged.push(k);
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.removed[k] = a[k];
  return out;
}

async function previewIsOn(page: Page): Promise<boolean> {
  const hide = page.getByRole("button", { name: /Hide preview|Back to editor/ });
  return (await hide.count()) > 0;
}

test.describe("preview migration — localStorage 3-snapshot diff", () => {
  test("diff between pre-migrate / post-migrate / post-toggle exposes only expected changes", async ({ page }, testInfo) => {
    await page.setViewportSize(DESKTOP);
    await seedLegacy(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const snapPre = await snapshot(page);

    await page.goto(notePath());
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
    const snapPostMigrate = await snapshot(page);

    await page.setViewportSize(MOBILE);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);
    await page.setViewportSize(DESKTOP);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(true);
    const snapPostToggle = await snapshot(page);

    const diffMigrate = diff(snapPre, snapPostMigrate);
    const diffToggle = diff(snapPostMigrate, snapPostToggle);

    await testInfo.attach("preview-localstorage-diff.json", {
      body: JSON.stringify(
        {
          snapPre,
          snapPostMigrate,
          snapPostToggle,
          diffMigrate,
          diffToggle,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    // Legacy key must survive every checkpoint (user data is sacred).
    expect(snapPre[PREVIEW_LEGACY], "legacy key missing pre-mount").toBe("1");
    expect(snapPostMigrate[PREVIEW_LEGACY], "migration deleted legacy key").toBe("1");
    expect(snapPostToggle[PREVIEW_LEGACY], "viewport toggle deleted legacy key").toBe("1");

    // Migration must NEVER remove the legacy key, and must add the wide key.
    expect(
      Object.keys(diffMigrate.removed),
      `migration removed keys: ${Object.keys(diffMigrate.removed).join(", ")}`,
    ).toEqual([]);
    expect(diffMigrate.added[PREVIEW_WIDE], "wide key not added by migration").toBe("1");

    // Viewport toggle must be a no-op for storage.
    expect(
      Object.keys(diffToggle.added),
      `viewport toggle added keys: ${Object.keys(diffToggle.added).join(", ")}`,
    ).toEqual([]);
    expect(
      Object.keys(diffToggle.removed),
      `viewport toggle removed keys: ${Object.keys(diffToggle.removed).join(", ")}`,
    ).toEqual([]);
    expect(
      Object.keys(diffToggle.changed),
      `viewport toggle mutated keys: ${JSON.stringify(diffToggle.changed)}`,
    ).toEqual([]);
  });
});
