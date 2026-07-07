// E2E: malformed PWA readiness state and disabled rename/duplicate deep
// links must not throw runtime errors (uncaught exceptions or console
// error logs). Guards against silent regressions where the readiness gate
// or 404 route surfaces a crash instead of a safe no-op.
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

function attachErrorCollectors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore benign network noise unrelated to our runtime code paths.
      if (/Failed to load resource|net::ERR_|favicon/i.test(text)) return;
      errors.push(`console.error: ${text}`);
    }
  });
  return errors;
}

const malformedValues: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "empty-string", value: "" },
  { label: "number-zero", value: 0 },
  { label: "empty-array", value: [] },
];

for (const { label, value } of malformedValues) {
  test(`no runtime errors when readiness state is malformed: ${label}`, async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.addInitScript((v) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = v as never;
    }, value);
    await page.goto("/");
    await page.waitForTimeout(1_200);
    expect(errors, `unexpected runtime errors for ${label}: ${errors.join("\n")}`).toEqual([]);
  });
}

const deepLinks = [
  "/note/anything/rename",
  "/note/anything/duplicate?target=bar&force=1",
  "/note/anything?action=rename",
  "/#/note/anything/duplicate",
  "/rename/anything",
];

for (const path of deepLinks) {
  test(`no runtime errors when hitting disabled deep link: ${path}`, async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto(path);
    await page.waitForTimeout(300);
    expect(errors, `unexpected runtime errors for ${path}: ${errors.join("\n")}`).toEqual([]);
  });
}
