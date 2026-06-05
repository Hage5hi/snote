// E2E: CommandPalette is lazily loaded. The `cmdk` bundle must NOT load on
// initial Home navigation, and pressing Ctrl/⌘+K must open the palette in a
// reasonable time even on a cold visit. Re-opening must be faster than the
// first open (no second network round-trip).
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";

async function seed(page: Page) {
  await page.addInitScript(
    ({ lang, ip }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
    },
    { lang: LANG_KEY, ip: IP_DETECTED_KEY },
  );
}

const CMDK_HINT_RE = /cmdk|CommandPaletteBody/i;

test.describe("CommandPalette — lazy chunk loading", () => {
  test("does not load cmdk chunk on cold Home, loads on first Ctrl+K", async ({ page }) => {
    await seed(page);

    const moduleRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.endsWith(".js") || url.includes("/@fs/") || url.includes("/src/")) {
        moduleRequests.push(url);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const preKeydown = moduleRequests.filter((u) => CMDK_HINT_RE.test(u));
    expect(preKeydown, `cmdk chunk loaded before Ctrl+K: ${preKeydown.join(", ")}`).toHaveLength(0);

    const moduleCountBefore = moduleRequests.length;
    const firstOpenMs = await page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      // Wait for the dialog to appear in the DOM.
      const deadline = t0 + 5000;
      while (performance.now() < deadline) {
        if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
        await new Promise((r) => setTimeout(r, 16));
      }
      return -1;
    });
    expect(firstOpenMs).toBeGreaterThan(0);
    expect(firstOpenMs).toBeLessThan(3000); // generous; CI cold-start

    // After opening, at least one new module request must have happened
    // (the dynamic import). If not, the lazy split isn't actually working.
    await page.waitForTimeout(100);
    expect(moduleRequests.length).toBeGreaterThanOrEqual(moduleCountBefore + 1);

    // Close + reopen — second open should be fast (no chunk fetch).
    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

    const moduleCountMid = moduleRequests.length;
    const secondOpenMs = await page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      const deadline = t0 + 2000;
      while (performance.now() < deadline) {
        if (document.querySelector("[cmdk-root], [role='dialog']")) return performance.now() - t0;
        await new Promise((r) => setTimeout(r, 16));
      }
      return -1;
    });
    expect(secondOpenMs).toBeGreaterThan(0);
    // Second open must not fetch additional code chunks.
    expect(moduleRequests.length).toBe(moduleCountMid);
    // And should be at least as fast as the first open.
    expect(secondOpenMs).toBeLessThanOrEqual(firstOpenMs + 50);
  });

  test("⌘+K opens the palette after F5", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    await expect(page.locator("[cmdk-root], [role='dialog']")).toBeVisible({ timeout: 5000 });
  });
});
