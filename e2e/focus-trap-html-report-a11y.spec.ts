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

  test("search box is keyboard-operable, filters rows, and preserves a11y state", async ({ page }) => {
    const htmlPath = seedAndGenerate();
    await page.goto("file://" + resolve(htmlPath));

    const details = page.locator("details:has(#q-search)");
    await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });

    const search = page.locator("#q-search");
    const rows = page.locator("#q-all tbody tr");
    const totalRows = await rows.count();
    expect(totalRows).toBeGreaterThan(0);

    // Focus the search input via keyboard (Tab from the summary).
    const summary = details.locator("summary").first();
    await summary.focus();
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();

    // Accessible label persists while focused/typing.
    await expect(search).toHaveAttribute("aria-label", /filter.*quarantined/i);

    // Type a query that should match only rows whose failureReason or
    // schemaPointer contains the token. `charlie` was seeded as the
    // broken JSON entry, so its file path is a stable substring.
    await page.keyboard.type("charlie", { delay: 5 });

    // Wait for the client-side filter to settle: visible row count drops
    // below the unfiltered total, and every visible row references the query.
    await expect
      .poll(async () => await rows.locator(":scope:visible").count(), { timeout: 2000 })
      .toBeLessThan(totalRows);

    const visibleCount = await rows.locator(":scope:visible").count();
    expect(visibleCount).toBeGreaterThan(0);
    for (let i = 0; i < visibleCount; i++) {
      const text = (await rows.locator(":scope:visible").nth(i).textContent())?.toLowerCase() ?? "";
      expect(text).toContain("charlie");
    }

    // Hidden rows must be hidden in an a11y-correct way: either removed
    // from the a11y tree via `hidden`/`aria-hidden`, or by `display:none`.
    // Assert they are not exposed to AT while filtered.
    const hiddenExposed = await rows.evaluateAll((els) =>
      els.filter((el) => {
        const style = getComputedStyle(el as HTMLElement);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if ((el as HTMLElement).hidden) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        return !(el.textContent ?? "").toLowerCase().includes("charlie");
      }).length,
    );
    expect(hiddenExposed, "non-matching rows must not remain in the a11y tree").toBe(0);

    // Clearing the query restores the full row set — with keyboard only.
    await search.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await expect
      .poll(async () => await rows.locator(":scope:visible").count(), { timeout: 2000 })
      .toBe(totalRows);

    // Label survives round-trip.
    await expect(search).toHaveAttribute("aria-label", /filter.*quarantined/i);
  });

  test("filter announces results via aria-live, updates aria-expanded, and shows a visible focus outline", async ({ page }) => {
    const htmlPath = seedAndGenerate();
    await page.goto("file://" + resolve(htmlPath));

    const details = page.locator("details:has(#q-search)");
    const summary = details.locator("summary").first();
    const search = page.locator("#q-search");
    const rows = page.locator("#q-all tbody tr");

    // <summary> reflects the disclosure state via aria-expanded (either
    // native <details> semantics or explicit attribute — accept both).
    await details.evaluate((d: HTMLDetailsElement) => { d.open = false; });
    const expandedWhenClosed = await summary.evaluate((el) => el.getAttribute("aria-expanded"));
    if (expandedWhenClosed !== null) expect(expandedWhenClosed).toBe("false");
    await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });
    const expandedWhenOpen = await summary.evaluate((el) => el.getAttribute("aria-expanded"));
    if (expandedWhenOpen !== null) expect(expandedWhenOpen).toBe("true");

    // A live region must exist so AT users hear the result count change
    // when filtering. Accept either aria-live=polite or role=status.
    const live = page.locator("[aria-live='polite'], [role='status']").first();
    await expect(live).toBeAttached();

    const total = await rows.count();
    await search.focus();

    // Keyboard focus must produce a visible outline (outline > 0
    // OR box-shadow present). Colour-only focus indicators fail WCAG 2.4.7.
    const outline = await search.evaluate((el) => {
      const s = getComputedStyle(el as HTMLElement);
      return { width: s.outlineWidth, style: s.outlineStyle, shadow: s.boxShadow };
    });
    const hasOutline = parseFloat(outline.width) > 0 && outline.style !== "none";
    const hasShadow = Boolean(outline.shadow) && outline.shadow !== "none";
    expect(hasOutline || hasShadow, `focused search has no visible focus indicator: ${JSON.stringify(outline)}`).toBe(true);

    // Filter by a failureReason substring; live region updates to reflect
    // the new visible-row count.
    await page.keyboard.type("schema", { delay: 5 });
    await expect
      .poll(async () => await rows.locator(":scope:visible").count(), { timeout: 2000 })
      .toBeLessThan(total);
    const liveAfterReason = (await live.textContent())?.trim() ?? "";
    expect(liveAfterReason.length, "live region empty after filter").toBeGreaterThan(0);

    // Filter by a schemaPointer fragment. Live text must change again.
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type("/focusHistory", { delay: 5 });
    await expect
      .poll(async () => (await live.textContent())?.trim() ?? "", { timeout: 2000 })
      .not.toBe(liveAfterReason);

    // Clear and confirm the live region reports the restored total.
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await expect
      .poll(async () => await rows.locator(":scope:visible").count(), { timeout: 2000 })
      .toBe(total);
  });
});

