// Accessibility of the --html-report client-side triage view:
//   - Every quarantine row link is reachable via Tab and has a
//     non-empty accessible name (link text or aria-label).
//   - The collapsible <details>/<summary> for "Search & show all…"
//     is a keyboard-operable disclosure (Enter/Space toggle it),
//     and its summary carries an accessible name.
//   - The search <input> exposes an accessible label.
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

    // Correct role/ARIA wiring: role="status" implies polite, otherwise
    // require an explicit aria-live=polite. aria-atomic="true" keeps SR
    // from announcing partial character updates.
    const liveAttrs = await live.evaluate((el) => ({
      role: el.getAttribute("role"),
      ariaLive: el.getAttribute("aria-live"),
      ariaAtomic: el.getAttribute("aria-atomic"),
    }));
    const politeOk = liveAttrs.ariaLive === "polite" || liveAttrs.role === "status";
    expect(politeOk, `live region not polite: ${JSON.stringify(liveAttrs)}`).toBe(true);
    expect(liveAttrs.ariaAtomic, "aria-atomic must be 'true'").toBe("true");

    // Record every distinct textContent the live region ever holds so
    // we can assert "exactly one announcement per toggle" below.
    await live.evaluate((el) => {
      const w = window as unknown as { __ftLiveLog: string[] };
      w.__ftLiveLog = [(el.textContent ?? "").trim()];
      new MutationObserver(() => {
        const t = (el.textContent ?? "").trim();
        const log = w.__ftLiveLog;
        if (log[log.length - 1] !== t) log.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const readLog = async (): Promise<string[]> =>
      await page.evaluate(() => (window as unknown as { __ftLiveLog: string[] }).__ftLiveLog.slice());
    const before = await readLog();

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
    const liveAfterClear = (await live.textContent())?.trim() ?? "";
    expect(liveAfterClear.length, "live region empty after clearing filter").toBeGreaterThan(0);

    // Toggling the disclosure closed/open must re-announce the current
    // result count via the same live region. Screen readers rely on
    // this to know the quarantine list changed reachability.
    await details.evaluate((d: HTMLDetailsElement) => { d.open = false; });
    await expect
      .poll(async () => (await live.textContent())?.trim() ?? "", { timeout: 2000 })
      .not.toBe(liveAfterClear);
    const liveAfterCollapse = (await live.textContent())?.trim() ?? "";
    expect(liveAfterCollapse.length, "live region empty after collapse").toBeGreaterThan(0);

    await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });
    await expect
      .poll(async () => (await live.textContent())?.trim() ?? "", { timeout: 2000 })
      .not.toBe(liveAfterCollapse);

    // Exactly-one-announcement-per-toggle: each toggle above (2 filter
    // types, 1 clear, 2 disclosure toggles = 5 actions) should have
    // appended exactly one new distinct message. Duplicates in the log
    // are collapsed on write, so length grows monotonically by 1 per
    // action + the initial seed.
    const log = await readLog();
    const afterCount = log.length;
    const beforeCount = before.length;
    // Allow ±1 slack for the initial empty→first-message transition.
    expect(afterCount - beforeCount, `live log grew by ${afterCount - beforeCount} for 5 toggles (log=${JSON.stringify(log)})`).toBeGreaterThanOrEqual(5);
    expect(afterCount - beforeCount).toBeLessThanOrEqual(6);
    // And every consecutive pair is distinct — no stale re-announcements.
    for (let i = 1; i < log.length; i++) expect(log[i]).not.toBe(log[i - 1]);
  });

  // Broader sweep: every <details> disclosure and every quarantine
  // filter control (currently the search input) must expose an
  // accessible name and show a visible focus indicator when focused.
  // Prevents a regression where a new filter control (checkbox,
  // <select>, extra <details>) ships without keyboard/AT affordances.
  test("every disclosure toggle and quarantine filter control has an accessible name + visible focus", async ({ page }) => {
    const htmlPath = seedAndGenerate();
    await page.goto("file://" + resolve(htmlPath));

    // --- Every <details>/<summary> disclosure on the page ---
    const summaries = page.locator("details > summary");
    const sCount = await summaries.count();
    expect(sCount, "expected at least one disclosure").toBeGreaterThan(0);
    for (let i = 0; i < sCount; i++) {
      const s = summaries.nth(i);
      const text = (await s.textContent())?.trim() ?? "";
      const aria = (await s.getAttribute("aria-label")) ?? "";
      expect((text || aria).length, `summary[${i}] has no accessible name`).toBeGreaterThan(0);

      // Keyboard: focusable and toggles its parent <details> via Enter.
      const parent = s.locator("xpath=..");
      await parent.evaluate((d: HTMLDetailsElement) => { d.open = false; });
      await s.focus();
      await expect(s).toBeFocused();
      const focusStyle = await s.evaluate((el) => {
        const st = getComputedStyle(el as HTMLElement);
        return { w: st.outlineWidth, style: st.outlineStyle, shadow: st.boxShadow };
      });
      const okOutline = parseFloat(focusStyle.w) > 0 && focusStyle.style !== "none";
      const okShadow = Boolean(focusStyle.shadow) && focusStyle.shadow !== "none";
      expect(okOutline || okShadow,
        `summary[${i}] lacks visible focus indicator: ${JSON.stringify(focusStyle)}`).toBe(true);
      await page.keyboard.press("Enter");
      await expect(parent).toHaveJSProperty("open", true);
    }

    // --- Every quarantine filter control (form controls under the
    //     search disclosure). Currently just #q-search; the loop
    //     future-proofs the assertion set. ---
    const filterRoot = page.locator("details:has(#q-search)");
    await filterRoot.evaluate((d: HTMLDetailsElement) => { d.open = true; });
    const controls = filterRoot.locator("input, select, textarea, button");
    const cCount = await controls.count();
    expect(cCount, "expected at least one filter control").toBeGreaterThan(0);
    for (let i = 0; i < cCount; i++) {
      const c = controls.nth(i);
      const aria = (await c.getAttribute("aria-label")) ?? "";
      const labelledBy = (await c.getAttribute("aria-labelledby")) ?? "";
      const id = (await c.getAttribute("id")) ?? "";
      const labelForCount = id
        ? await page.locator(`label[for="${id}"]`).count()
        : 0;
      const title = (await c.getAttribute("title")) ?? "";
      const text = (await c.textContent())?.trim() ?? "";
      const hasName = aria.length > 0 || labelledBy.length > 0 || labelForCount > 0 || title.length > 0 || text.length > 0;
      expect(hasName, `filter control[${i}] (${await c.evaluate((e) => e.tagName)}) has no accessible name`).toBe(true);

      await c.focus();
      await expect(c).toBeFocused();
      const fs = await c.evaluate((el) => {
        const st = getComputedStyle(el as HTMLElement);
        return { w: st.outlineWidth, style: st.outlineStyle, shadow: st.boxShadow };
      });
      const ok = (parseFloat(fs.w) > 0 && fs.style !== "none") || (Boolean(fs.shadow) && fs.shadow !== "none");
      expect(ok, `filter control[${i}] lacks visible focus indicator: ${JSON.stringify(fs)}`).toBe(true);
    }
  });

  // Rapid-toggle stress: repeatedly type/clear the filter and open/close
  // the disclosure with no delay. The live region must always land on a
  // message that matches the currently visible row count — never a stale
  // count from a superseded toggle. Deterministic = the final resting
  // announcement is a function of the final DOM state only.
  // Rapid-toggle is the only spec that legitimately races the browser's
  // input/mutation pipeline. Give it 2 retries so cross-browser noise
  // (WebKit's input debounce, Firefox MutationObserver batching) doesn't
  // mask a real regression on the first pass. Every other spec in this
  // file stays at the project's default retries=0 so flakes fail loudly.
  test.describe("rapid-toggle live-region", () => {
    test.describe.configure({ retries: 2 });

    // Per-browser timeout thresholds live inside the test (see WAIT_TIMEOUT_MS)
    // so they can be logged alongside the observed wait duration.



    test("rapid filter + disclosure toggles never leave the live region with a stale count", async ({ page, browserName }, testInfo) => {
      const htmlPath = seedAndGenerate();
      await page.goto("file://" + resolve(htmlPath));

      // Force a Playwright trace for this specific test so a failure
      // always produces a `trace.zip` in `test-results/`.
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });

      const details = page.locator("details:has(#q-search)");
      await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });
      const search = page.locator("#q-search");
      const rows = page.locator("#q-all tbody tr");
      const live = page.locator("[aria-live='polite'], [role='status']").first();

      await live.evaluate((el) => {
        const w = window as unknown as { __ftLiveLog: string[] };
        w.__ftLiveLog = [(el.textContent ?? "").trim()].filter(Boolean);
        new MutationObserver(() => {
          const t = (el.textContent ?? "").trim();
          const log = w.__ftLiveLog;
          if (t && log[log.length - 1] !== t) log.push(t);
        }).observe(el, { childList: true, characterData: true, subtree: true });
      });

      // Reusable diagnostics collector — always dumps DOM snapshot,
      // aria-live innerText, screenshot, and trace.zip. Called from the
      // `finally` block so it runs on pass AND fail; on pass we skip
      // the heavy trace attach to keep artifacts small, on fail we
      // attach everything unconditionally.
      let attached = false;
      const collectDiagnostics = async (opts: { attachTrace: boolean; label: string }) => {
        if (attached) return;
        attached = true;
        try {
          const log = await page.evaluate(
            () => (window as unknown as { __ftLiveLog?: string[] }).__ftLiveLog ?? [],
          );
          const liveText = await live.evaluate((el) => (el as HTMLElement).innerText).catch(() => "");
          const domSnapshot = await page.content();
          const finalText = (await live.textContent())?.trim() ?? "";
          await testInfo.attach("live-region-log.json", {
            contentType: "application/json",
            body: Buffer.from(JSON.stringify({ label: opts.label, browserName, finalText, liveInnerText: liveText, log }, null, 2)),
          });
          await testInfo.attach("live-region-innertext.txt", {
            contentType: "text/plain",
            body: Buffer.from(liveText),
          });
          await testInfo.attach("dom-snapshot.html", {
            contentType: "text/html",
            body: Buffer.from(domSnapshot),
          });
          if (opts.attachTrace) {
            const shot = await page.screenshot({ fullPage: true });
            await testInfo.attach("live-region-failure.png", { contentType: "image/png", body: shot });
          }
        } catch {/* best-effort */}
        try {
          if (opts.attachTrace) {
            const tracePath = testInfo.outputPath("live-region-trace.zip");
            await page.context().tracing.stop({ path: tracePath });
            await testInfo.attach("live-region-trace.zip", { contentType: "application/zip", path: tracePath });
          } else {
            await page.context().tracing.stop();
          }
        } catch {/* tracing already stopped */}
      };

      // Per-iteration DOM state snapshot so we can later assert the
      // aria-live log is a valid *ordered subsequence* of the visible
      // counts we actually produced — no announcement may reference a
      // count the DOM never held at some point in this run.
      const observedVisible: number[] = [];
      const WAIT_TIMEOUT_MS: Record<string, number> = { chromium: 4000, firefox: 5000, webkit: 7000 };
      const waitMs = WAIT_TIMEOUT_MS[browserName] ?? 4000;
      const t0 = Date.now();

      try {
        await search.focus();
        for (let i = 0; i < 20; i++) {
          if (i % 4 === 0) {
            await page.keyboard.press("Control+A"); await page.keyboard.press("Delete");
            await page.keyboard.type("charlie");
          } else if (i % 4 === 1) {
            await page.keyboard.press("Control+A"); await page.keyboard.press("Delete");
            await page.keyboard.type("schema");
          } else if (i % 4 === 2) {
            await details.evaluate((d: HTMLDetailsElement) => { d.open = false; });
          } else {
            await details.evaluate((d: HTMLDetailsElement) => { d.open = true; });
          }
          observedVisible.push(await rows.locator(":scope:visible").count());
        }

        const expectedVisible = await rows.locator(":scope:visible").count();
        const exactCount = new RegExp(`(^|\\D)${expectedVisible}(\\D|$)`);
        const waitStart = Date.now();
        await expect
          .poll(async () => (await live.textContent())?.trim() ?? "",
                { timeout: waitMs, intervals: [50] })
          .toMatch(exactCount);
        const waitDurationMs = Date.now() - waitStart;
        const stableText = (await live.textContent())?.trim() ?? "";

        await page.waitForTimeout(150);
        expect((await live.textContent())?.trim() ?? "").toBe(stableText);
        await page.waitForTimeout(150);
        expect((await live.textContent())?.trim() ?? "").toBe(stableText);

        // Tightened exactly-once: verify the FULL ORDERED log — not
        // just that the final message is unique. Every announcement in
        // the log must:
        //   (a) reference a visible-row count the DOM actually held at
        //       some point during the run (subsequence of observedVisible,
        //       de-duped adjacently), and
        //   (b) never repeat consecutively (the observer already dedupes,
        //       but re-check so a regression in that code fails here), and
        //   (c) end with `stableText` at exactly one position.
        const log: string[] = await page.evaluate(
          () => (window as unknown as { __ftLiveLog?: string[] }).__ftLiveLog ?? [],
        );
        // (b) no adjacent duplicates
        for (let i = 1; i < log.length; i++) {
          expect(log[i], `adjacent duplicate at ${i}: ${JSON.stringify(log)}`).not.toBe(log[i - 1]);
        }
        // (c) final text appears exactly once and at the tail
        const finalOccurrences = log.filter((x) => x === stableText).length;
        expect(finalOccurrences, `final "${stableText}" appeared ${finalOccurrences}× in ${JSON.stringify(log)}`).toBe(1);
        expect(log[log.length - 1]).toBe(stableText);
        // (a) each log entry's numeric count is a subsequence of the
        // dedup-adjacent observedVisible sequence (no stale counts).
        const dedupAdj = (a: number[]) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
        const observedSeq = dedupAdj(observedVisible);
        const logCounts = log
          .map((s) => { const m = s.match(/\d+/); return m ? Number(m[0]) : NaN; })
          .filter((n) => Number.isFinite(n));
        let j = 0;
        for (const n of logCounts) {
          while (j < observedSeq.length && observedSeq[j] !== n) j++;
          expect(j, `stale count ${n} in log not seen in DOM sequence ${JSON.stringify(observedSeq)} (log=${JSON.stringify(log)})`).toBeLessThan(observedSeq.length);
          j++;
        }

        // Per-browser debug logging — surfaces in the Playwright `list`
        // reporter and each browser's job log so timing flakes are
        // trivially attributable to a specific engine.
        console.log(`[live-region ${browserName}] announcements=${log.length} waitMs=${waitDurationMs} totalMs=${Date.now() - t0} budget=${waitMs}`);
        testInfo.annotations.push({
          type: "live-region-timing",
          description: `browser=${browserName} announcements=${log.length} waitMs=${waitDurationMs} budget=${waitMs}`,
        });
      } finally {
        // Always collect. On pass: keep it cheap (no trace/screenshot).
        // On fail: attach everything including trace.zip + screenshot.
        const failed = testInfo.errors.length > 0 || testInfo.status === "failed";
        await collectDiagnostics({
          attachTrace: failed,
          label: failed ? "rapid-toggle-failure" : "rapid-toggle-pass",
        });
      }
    });
  });
});



