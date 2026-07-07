// E2E: strict console gate for ALL rename/duplicate deep-link variants.
// Any console.error, pageerror, or unhandled exception fails the test.
// Only warnings matching WARNING_WHITELIST are tolerated.
import { test, expect, type ConsoleMessage } from "@playwright/test";

const WARNING_WHITELIST: RegExp[] = [
  /React Router Future Flag/i,
  /Download the React DevTools/i,
  /Lovable/i,
  /vite/i,
  /\[pwa-update/i,
];

const variants = [
  "/note/anything/rename",
  "/note/anything/duplicate",
  "/note/anything/rename?name=foo",
  "/note/anything/duplicate?target=bar&force=1",
  "/note/anything?action=rename",
  "/note/anything?action=duplicate",
  "/#/note/anything/rename",
  "/#/note/anything/duplicate",
  "/note/anything#rename",
  "/note/anything#duplicate",
  "/rename/anything",
  "/duplicate/anything",
];

for (const path of variants) {
  test(`strict console gate for disabled deep-link: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (msg.type() === "error") errors.push(text);
      else if (msg.type() === "warning") warnings.push(text);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto(path);
    await page.waitForTimeout(400);

    expect(errors, `errors on ${path}:\n${errors.join("\n")}`).toEqual([]);
    const unlisted = warnings.filter((w) => !WARNING_WHITELIST.some((re) => re.test(w)));
    expect(unlisted, `unlisted warnings on ${path}:\n${unlisted.join("\n")}`).toEqual([]);
  });
}
