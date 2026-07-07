// E2E: neither a malformed PWA readiness state nor a disabled
// rename/duplicate deep-link may emit an uncaught runtime error in the
// browser console. Only explicitly whitelisted warnings are tolerated.
import { test, expect, type ConsoleMessage } from "@playwright/test";

// Warnings that predate this change and are known-safe. Keep this list
// tiny — every new entry is a footgun.
const WARNING_WHITELIST: RegExp[] = [
  /React Router Future Flag/i,
  /Download the React DevTools/i,
  /Lovable/i,
  /vite/i,
  /\[pwa-update/i,
];

function collectConsole(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const onMsg = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error") errors.push(text);
    else if (msg.type() === "warning") warnings.push(text);
  };
  page.on("console", onMsg);
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return { errors, warnings };
}

const malformedValues: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "empty-string", value: "" },
  { label: "empty-array", value: [] },
  { label: "number-zero", value: 0 },
];

for (const { label, value } of malformedValues) {
  test(`no runtime errors under malformed readiness (${label})`, async ({ page }) => {
    const { errors, warnings } = collectConsole(page);
    await page.addInitScript((v) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = v as never;
    }, value);
    await page.goto("/");
    await page.waitForTimeout(1_500);

    expect(errors, `unexpected console errors: ${errors.join("\n")}`).toEqual([]);
    const unlisted = warnings.filter((w) => !WARNING_WHITELIST.some((re) => re.test(w)));
    expect(unlisted, `unexpected console warnings: ${unlisted.join("\n")}`).toEqual([]);
  });
}

const disabledDeepLinks = [
  "/note/anything/rename",
  "/note/anything/duplicate",
  "/note/anything/rename?name=foo",
  "/note/anything?action=duplicate",
  "/#/note/anything/rename",
  "/rename/anything",
  "/duplicate/anything",
];

for (const path of disabledDeepLinks) {
  test(`no runtime errors on disabled deep-link: ${path}`, async ({ page }) => {
    const { errors, warnings } = collectConsole(page);
    await page.goto(path);
    await page.waitForTimeout(500);

    expect(errors, `unexpected console errors on ${path}: ${errors.join("\n")}`).toEqual([]);
    const unlisted = warnings.filter((w) => !WARNING_WHITELIST.some((re) => re.test(w)));
    expect(unlisted, `unexpected console warnings on ${path}: ${unlisted.join("\n")}`).toEqual([]);
  });
}
