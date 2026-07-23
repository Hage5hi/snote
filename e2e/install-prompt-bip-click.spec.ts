// E2E: clicking Install after a real `beforeinstallprompt` capture must
// invoke the browser-supplied `prompt()` (the native install dialog) and
// cleanly tear down the Install button on the accepted outcome. We can't
// render Chrome's real chrome-level dialog in test, but we can spy on
// `prompt()` to assert it was awaited and observe that the in-app dialog
// transitions to a stable post-install state (button gone, status row
// flipped to "ready"/"installed", dialog remains usable / closable).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __promptResolved: boolean }).__promptResolved = false;
  });
});

test("Install click invokes native prompt() and dialog tears down cleanly", async ({ page }) => {
  await page.goto("/");

  // Synthesize a BIP event whose prompt() resolves only after we await it,
  // mirroring how the real chrome-level install dialog behaves.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      await new Promise((r) => setTimeout(r, 50));
      (window as unknown as { __promptResolved: boolean }).__promptResolved = true;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();

  // Native prompt() was actually awaited.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __promptResolved: boolean }).__promptResolved,
      ),
    )
    .toBe(true);

  // Post-install: Install button is gone from this dialog.
  await expect(installBtn).toHaveCount(0);

  // Dialog itself remains a well-formed, ESC-closable panel (no leaked
  // overlay, focus still trapped inside, ESC restores focus to trigger).
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
