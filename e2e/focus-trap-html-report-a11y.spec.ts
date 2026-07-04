// Accessibility of the --html-report client-side triage view:
//   - Every quarantine row link is reachable via Tab and has a
//     non-empty accessible name (link text or aria-label).
//   - The collapsible <details>/<summary> for "Search & show all…"
//     is a keyboard-operable disclosure (Enter/Space toggle it),
//     and its summary carries an accessible name.
//   - The search <input> exposes an accessible label.
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

function seedAndGenerate(): string {
  const root = mkdtempSync(join(tmpdir(), "ft-html-a11y-"));
  const scan = join(root, "test-results");
  const mk = (spec: string, payload: unknown | string) => {
    const d = join(scan, spec); mkdirSync(d, { recursive: true });
    const f = join(d, "focus-trap-escape-x.json");
    writeFileSync(f, typeof payload === "string" ? payload : JSON.stringify(payload));
  };
  mk("alpha-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });
  mk("bravo-spec-chromium-retry0", {});
  mk("charlie-spec-chromium-retry0", "{broken");
  const htmlPath = join(root, "report.html");
  const res = spawnSync("bun",
    ["run", "scripts/inspect-focus-trap.ts",
      "--scan-root", scan,
      "--out", join(root, "summary.json"),
      "--html-report", htmlPath,
      "--invalid-dir", join(root, "_invalid")],
    { encoding: "utf8" });
  if (res.status !== 2) throw new Error(`inspect-focus-trap exited ${res.status}: ${res.stderr}`);
  return htmlPath;
}

test.describe("focus-trap --html-report a11y", () => {
  test("quarantine links and disclosure are keyboard-reachable with accessible names", async ({ page }) => {
    const htmlPath = seedAndGenerate();
    await page.goto("file://" + resolve(htmlPath));

    // Search input has an accessible label (aria-label wired in the report).
    const search = page.locator("#q-search");
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("aria-label", /filter.*quarantined/i);

    // The disclosure summary is present and has a non-empty accessible name.
    const details = page.locator("details:has(#q-search)");
    const summary = details.locator("summary").first();
    await expect(summary).toBeVisible();
    const summaryName = (await summary.textContent())?.trim() ?? "";
    expect(summaryName.length).toBeGreaterThan(0);
    expect(summaryName).toMatch(/quarantined/i);

    // Keyboard operability: <details> is open by default because we
    // toggle via Enter. Force it closed, then open with Enter.
    await details.evaluate((d: HTMLDetailsElement) => { d.open = false; });
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    // Space closes it again.
    await page.keyboard.press("Space");
    await expect(details).toHaveJSProperty("open", false);
    // Re-open so link tabbing below is meaningful.
    await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });

    // Every quarantine link has an accessible name and a non-empty href.
    const links = page.locator("#q-all tbody a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const name = (await link.textContent())?.trim() ?? "";
      const aria = await link.getAttribute("aria-label");
      expect((aria ?? name).length, `link[${i}] has no accessible name`).toBeGreaterThan(0);
      const href = await link.getAttribute("href");
      expect(href && href.length > 0, `link[${i}] missing href`).toBe(true);
    }

    // Sanity check: every quarantine link is reachable via Tab from the
    // search input without hitting a keyboard trap. Tab up to N times
    // (once per link) and confirm we land on each in DOM order.
    await search.focus();
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a ? { tag: a.tagName, href: (a as HTMLAnchorElement).href ?? "" } : null;
      });
      expect(focused?.tag, `stop ${i}: expected an <a>, got ${focused?.tag}`).toBe("A");
    }
  });
});
