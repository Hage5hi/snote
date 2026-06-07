// E2E: snapshot the full localStorage key list at three checkpoints —
//   1) before mount (pre-migrate),
//   2) after the hook mounts (post-migrate),
//   3) after toggling viewport desktop → mobile → desktop,
// — to prove that (a) the legacy `notes:preview-visible` key is NEVER deleted
// by the migration, and (b) viewport changes only flip the in-memory preview
// fallback without touching storage or throwing pageerrors.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_LEGACY = "notes:preview-visible";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

function notePath() {
  return `/e2e-ls-snap-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedLegacy(page: Page) {
  await page.addInitScript(
    ({ lang, ip, legacy, wide, narrow }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
      localStorage.removeItem(wide);
      localStorage.removeItem(narrow);
      localStorage.setItem(legacy, "1"); // legacy preview flag to migrate
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

async function snapshotKeys(page: Page): Promise<{ keys: string[]; legacy: string | null }> {
  return page.evaluate((legacyKey) => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    keys.sort();
    return { keys, legacy: localStorage.getItem(legacyKey) };
  }, PREVIEW_LEGACY);
}

async function previewIsOn(page: Page): Promise<boolean> {
  const hide = page.getByRole("button", { name: /Hide preview|Back to editor/ });
  return (await hide.count()) > 0;
}

test.describe("preview migration — localStorage snapshot guardrail", () => {
  test("legacy key survives migrate + desktop→mobile→desktop toggle, no pageerror", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.setViewportSize(DESKTOP);
    await seedLegacy(page);

    // (1) Pre-mount snapshot: navigate to a benign URL first so we can read
    // localStorage WITHOUT the preview-visible hook running yet. The init
    // script seeded the legacy key before any page script ran.
    await page.goto("about:blank");
    // about:blank has its own storage realm — switch via app navigation:
    // do the actual snapshot via an init-script-armed page that doesn't
    // mount the hook. Easiest: go to "/" (Home) which doesn't toggle
    // preview-visible state, then snapshot before opening the note.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const beforeMigrate = await snapshotKeys(page);
    expect(beforeMigrate.legacy, "seed failed: legacy key missing pre-mount").toBe("1");
    expect(beforeMigrate.keys, "wide key should not exist pre-mount").not.toContain(PREVIEW_WIDE);

    // (2) Open the note → mounts use-preview-visible → migration runs.
    await page.goto(notePath());
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    const afterMigrate = await snapshotKeys(page);
    expect(afterMigrate.legacy, "migration deleted legacy key — user data lost").toBe("1");
    expect(afterMigrate.keys, "legacy key missing from snapshot post-migrate").toContain(PREVIEW_LEGACY);
    // Migration should mirror into the wide key (we're on DESKTOP).
    expect(afterMigrate.keys, "wide key missing post-migrate").toContain(PREVIEW_WIDE);

    // (3) Toggle viewport desktop → mobile → desktop. Storage must be stable;
    // viewport changes are an in-memory fallback only.
    await page.setViewportSize(MOBILE);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);
    await page.setViewportSize(DESKTOP);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(true);

    const afterToggle = await snapshotKeys(page);
    expect(afterToggle.legacy, "legacy key was mutated during viewport toggle").toBe("1");
    // The key set should not grow due to viewport toggles alone (no narrow
    // write unless user explicitly toggles preview on mobile).
    const newlyAdded = afterToggle.keys.filter((k) => !afterMigrate.keys.includes(k));
    expect(newlyAdded, `viewport toggle wrote unexpected keys: ${newlyAdded.join(", ")}`).toEqual([]);

    expect(errors, `unexpected pageerror during snapshot run: ${errors.join("\n")}`).toEqual([]);
  });
});
