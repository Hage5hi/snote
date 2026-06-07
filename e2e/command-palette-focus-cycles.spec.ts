// E2E: after multiple F5 reloads and repeated open/close cycles of the
// CommandPalette, focus must remain inside the `#root/main/body` container
// at all times while the dialog is open — Tab/Shift+Tab never escapes to
// <body> or to background decoys, no matter how many cycles we run.
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

async function installDecoys(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("e2e-focus-decoys")) return;
    const host = document.createElement("div");
    host.id = "e2e-focus-decoys";
    host.style.cssText = "position:fixed;left:-9999px;top:0;";
    for (let i = 0; i < 3; i++) {
      const b = document.createElement("button");
      b.textContent = `decoy-${i}`;
      b.setAttribute("data-e2e-decoy", String(i));
      host.appendChild(b);
    }
    document.body.appendChild(host);
  });
}

async function openPalette(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  });
  await expect(page.locator("[cmdk-root], [role='dialog']")).toBeVisible({ timeout: 5000 });
}

async function snapshotActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector("[role='dialog']");
    return {
      isBody: el === document.body,
      isDecoy: !!el?.hasAttribute("data-e2e-decoy"),
      inContainer: !!el && !!document.querySelector("#root, main, body")?.contains(el),
      inDialog: !!dialog && !!el && dialog.contains(el),
    };
  });
}

test.describe("CommandPalette — focus stays in container across F5 + cycles", () => {
  test("Tab/Shift+Tab never escapes #root/main/body across many cycles", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const RELOADS = 3;
    const CYCLES_PER_RELOAD = 3;
    const TABS_PER_CYCLE = 8;

    for (let r = 0; r < RELOADS; r++) {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await installDecoys(page);

      for (let c = 0; c < CYCLES_PER_RELOAD; c++) {
        await openPalette(page);
        await expect.poll(() => snapshotActive(page).then((s) => s.inDialog), {
          timeout: 2000,
        }).toBe(true);

        for (let t = 0; t < TABS_PER_CYCLE; t++) {
          const key = t % 2 === 0 ? "Tab" : "Shift+Tab";
          await page.keyboard.press(key);
          const s = await snapshotActive(page);
          const label = `reload#${r + 1} cycle#${c + 1} ${key}#${t + 1}`;
          expect(s.isBody, `${label}: focus landed on <body>`).toBe(false);
          expect(s.isDecoy, `${label}: focus escaped to background decoy`).toBe(false);
          expect(s.inContainer, `${label}: focus left #root/main/body container`).toBe(true);
          expect(s.inDialog, `${label}: focus escaped the dialog`).toBe(true);
        }

        await page.keyboard.press("Escape");
        await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({
          timeout: 2000,
        });
      }
    }
  });
});
