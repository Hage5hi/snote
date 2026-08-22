import { test, expect } from "./fixtures/extension";

test("Settings page persists mode + survives reload", async ({ context, extensionId, serviceWorker }) => {
  // Open options page in a tab (open_in_tab is false in manifest, but loading
  // the URL directly works for the test).
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // Wait for the deterministic ready signal: the form stays inert until
  // synced settings and the local telemetry preference have loaded, so a
  // late storage callback can never overwrite what the test (or a user)
  // entered. No sleeps.
  await expect(page.locator("#settings")).toHaveAttribute("data-settings-ready", "true");
  await page.locator('input[name="openMode"][value="slug"]').check();
  await page.locator("#defaultSlug").fill("journal");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("✓ Saved");

  // Verify persisted in chrome.storage.sync.
  const stored = await serviceWorker.evaluate(
    () =>
      new Promise((resolve) => {
        // @ts-expect-error chrome global in SW
        chrome.storage.sync.get({ openMode: "home", defaultSlug: "" }, resolve);
      }),
  );
  expect(stored).toMatchObject({ openMode: "slug", defaultSlug: "journal" });

  // Reload the options page → values restored (again gated on ready).
  await page.reload();
  await expect(page.locator("#settings")).toHaveAttribute("data-settings-ready", "true");
  await expect(page.locator('input[name="openMode"][value="slug"]')).toBeChecked();
  await expect(page.locator("#defaultSlug")).toHaveValue("journal");
});
