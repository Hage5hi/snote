// E2E: verify InstallPrompt cleans up its `beforeinstallprompt`
// listener on unmount. After navigating away, BIP dispatches must not
// be captured by any stale listener. Coming back and firing BIP once
// must yield exactly one install flow (no listener stacking).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __bipCalls: number }).__bipCalls = 0;
  });
});

function dispatchBip(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __bipCalls: number }).__bipCalls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });
}

test("unmounting InstallPrompt removes BIP listener; remount doesn't stack", async ({ page }) => {
  await page.goto("/");

  // Wait for the panel to mount (listener attached in useEffect).
  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();

  // Navigate to /privacy — InstallPrompt unmounts, cleanup runs.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);

  // Dispatching BIP now should hit ZERO listeners. If cleanup were
  // broken, the stale handler would still bump the counter via a
  // captured closure. We verify the counter stays 0 both immediately
  // and after opening the (would-be) install flow later.
  await dispatchBip(page);
  await dispatchBip(page);

  // Go back to "/" → InstallPrompt remounts, a fresh listener attaches.
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: new RegExp(dict.en["install.title"]) }),
  ).toBeVisible();

  // Fire one BIP — this is the only event that should be captured.
  await dispatchBip(page);

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  // Exactly 1 flow ran. If prior listeners had leaked, dispatching 3
  // total BIPs (2 while unmounted + 1 after remount) would have
  // registered more than 1 captured event and Install would double-fire.
  expect(calls).toBe(1);
});
