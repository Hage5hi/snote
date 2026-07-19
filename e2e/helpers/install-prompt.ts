// Shared helpers for install-prompt e2e specs.
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { dict } from "../../src/i18n/index";

const TRIGGER_NONCE_ATTR = "data-e2e-trigger-nonce";


/**
 * Reset the prompt() spy counters on `window` so every dialog open in a
 * test starts from zero. Prevents false "listener accumulated" failures
 * when a test reopens the dialog multiple times.
 */
export async function resetPromptSpy(
  page: Page,
  keys: readonly string[] = ["__calls", "__firstCalls", "__secondCalls", "__bipCalls"],
) {
  await page.evaluate((ks) => {
    for (const k of ks) {
      (window as unknown as Record<string, number>)[k] = 0;
    }
  }, keys as string[]);
}

/**
 * Assert focus is inside the open dialog. On failure, attach a DOM
 * dump (focusable list + activeElement descriptor + dialog outerHTML
 * preview) to the Playwright test report so it's obvious why Shift+Tab
 * escaped the focus trap.
 */
export async function expectFocusInsideDialog(
  page: Page,
  testInfo: TestInfo,
  label: string,
  opts: { triggerNonce?: string } = {},
) {
  const info = await page.evaluate((nonceAttr) => {
    const dlg = document.querySelector('[role="dialog"]');
    const active = document.activeElement as HTMLElement | null;
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const describe = (el: Element | null) =>
      el
        ? {
            tag: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || null,
            name: el.getAttribute("name"),
            ariaLabel: el.getAttribute("aria-label"),
            role: el.getAttribute("role"),
            text: (el.textContent || "").trim().slice(0, 60),
          }
        : null;
    const focusables = dlg
      ? Array.from(dlg.querySelectorAll<HTMLElement>(sel)).map(describe)
      : [];
    const nonceEl = document.querySelector(`[${nonceAttr}]`);
    // Sanitize the dialog HTML: strip inline event handlers, <script>
    // tags, and mask input `value` attributes so nothing user-typed
    // (e.g. tokens) leaks into CI artifacts. Preserve structure so the
    // rendered DOM shape is diagnosable.
    let dialogHtml: string | null = null;
    if (dlg) {
      const clone = (dlg as HTMLElement).cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script,style").forEach((n) => n.remove());
      clone.querySelectorAll<HTMLElement>("*").forEach((n) => {
        for (const a of Array.from(n.attributes)) {
          if (a.name.startsWith("on")) n.removeAttribute(a.name);
        }
        if (n.tagName === "INPUT" || n.tagName === "TEXTAREA") {
          if (n.hasAttribute("value")) n.setAttribute("value", "[redacted]");
        }
      });
      dialogHtml = clone.outerHTML.slice(0, 4000);
    }
    return {
      dialogPresent: !!dlg,
      dialogContainsActive: !!(dlg && active && dlg.contains(active)),
      activeElement: describe(active),
      focusables,
      latestTriggerNonce: nonceEl?.getAttribute(nonceAttr) ?? null,
      dialogHtmlSanitized: dialogHtml,
      lastRelocate: (window as unknown as { __ipRelocate?: unknown }).__ipRelocate ?? null,
      focusHistory:
        (window as unknown as { __ipFocusHistory?: unknown[] }).__ipFocusHistory ?? [],
    };
  }, TRIGGER_NONCE_ATTR);

  // Compute per-iteration durations from `note:iter-N-*` checkpoints.
  const iterDurations: Record<string, Record<string, number>> = {};
  const notes = (info.focusHistory as Array<{ event?: string; perf?: number }>).filter(
    (e) => typeof e.event === "string" && e.event.startsWith("note:iter-"),
  );
  for (const e of notes) {
    const m = /^note:iter-(\d+)-(before-open|after-open|after-close)$/.exec(e.event!);
    if (!m || typeof e.perf !== "number") continue;
    const key = `iter-${m[1]}`;
    (iterDurations[key] ||= {})[m[2]] = e.perf;
  }
  const iterTimings = Object.fromEntries(
    Object.entries(iterDurations).map(([k, v]) => [
      k,
      {
        ...v,
        openMs: v["after-open"] != null && v["before-open"] != null ? v["after-open"] - v["before-open"] : null,
        closeMs: v["after-close"] != null && v["after-open"] != null ? v["after-close"] - v["after-open"] : null,
        totalMs: v["after-close"] != null && v["before-open"] != null ? v["after-close"] - v["before-open"] : null,
      },
    ]),
  );

  const payload: Record<string, unknown> = {
    label,
    testTitle: testInfo.title,
    triggerNonce: opts.triggerNonce ?? info.latestTriggerNonce,
    iterTimings,
    ...info,
  };

  if (!info.dialogContainsActive) {
    const base = `focus-trap-escape-${label}`;
    const jsonName = `${base}.json`;
    const pngName = `${base}.png`;
    const htmlName = `${base}.html`;
    const captureDisabled = process.env.IP_CAPTURE_DISABLED === "1";
    const htmlMax = Math.max(1024, Number(process.env.IP_HTML_MAX) || 200_000);

    // Relative filenames (basename only) are stable across CI ZIPs and
    // let reviewers click straight from the JSON to sibling artifacts.
    payload.artifacts = {
      json: jsonName,
      screenshot: captureDisabled ? null : pngName,
      pageHtml: captureDisabled ? null : htmlName,
    };

    // Clickable deep links: build against IP_ARTIFACT_BASE_URL when set
    // by CI (e.g. the artifact HTTP base for the run). The URL is joined
    // with the test's outputDir relative to repo root so reviewers can
    // open the PNG/HTML straight from the JSON.
    const artifactBaseUrl = (process.env.IP_ARTIFACT_BASE_URL || "").replace(/\/+$/, "");
    if (artifactBaseUrl) {
      const path = await import("node:path");
      const rel = path.relative(process.cwd(), testInfo.outputDir).replace(/\\/g, "/");
      const mk = (name: string | null) => (name ? `${artifactBaseUrl}/${rel}/${name}` : null);
      payload.artifactUrls = {
        json: mk(jsonName),
        screenshot: captureDisabled ? null : mk(pngName),
        pageHtml: captureDisabled ? null : mk(htmlName),
      };
    }



    if (!captureDisabled) {
      try {
        const shotPath = `${testInfo.outputDir}/${pngName}`;
        const htmlPath = `${testInfo.outputDir}/${htmlName}`;
        const fs = await import("node:fs/promises");
        await fs.mkdir(testInfo.outputDir, { recursive: true });
        await page.screenshot({ path: shotPath, fullPage: false });
        const html = await page.content();
        await fs.writeFile(htmlPath, html.slice(0, htmlMax));
        payload.screenshotPath = shotPath;
        payload.pageHtmlPath = htmlPath;
        payload.pageHtmlBytes = Math.min(html.length, htmlMax);
        await testInfo.attach(pngName, { path: shotPath, contentType: "image/png" });
        await testInfo.attach(htmlName, { path: htmlPath, contentType: "text/html" });
      } catch (err) {
        payload.captureError = String(err);
      }
    }



    await testInfo.attach(jsonName, {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(testInfo.outputDir, { recursive: true });
      await fs.writeFile(
        path.join(testInfo.outputDir, jsonName),
        JSON.stringify(payload, null, 2),
      );
    } catch {
      /* best-effort */
    }
  }
  expect(info.dialogContainsActive, `focus escaped at ${label}`).toBe(true);
}



/**
 * Robust re-location of the install trigger button after the dialog
 * closes. Radix re-renders / re-mounts DialogTrigger, so a Locator
 * captured before opening can become detached. This helper:
 *   1. Tags the element with a stable data attribute + a unique nonce
 *      before opening so we can re-select the SAME node afterwards.
 *   2. Returns a locator that filters by that nonce, and asserts it
 *      resolves to exactly one element before use.
 *
 * Usage:
 *   const trigger = await captureInstallTrigger(page);
 *   await trigger.click();
 *   // ... open + close dialog ...
 *   const same = await relocateInstallTrigger(page, trigger);
 *   await expect(same).toBeFocused();
 */

export interface CapturedTrigger {
  locator: Locator;
  nonce: string;
}

export async function captureInstallTrigger(page: Page): Promise<CapturedTrigger> {
  const base = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(base).toBeVisible();
  const nonce = `ip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await base.evaluate(
    (el, args) => el.setAttribute(args.attr, args.n),
    { attr: TRIGGER_NONCE_ATTR, n: nonce },
  );
  const locator = page.locator(`[${TRIGGER_NONCE_ATTR}="${nonce}"]`);
  await expect(locator).toHaveCount(1);
  return { locator, nonce };
}

/**
 * Re-locate the install trigger by nonce; if Radix remounted the
 * DialogTrigger and dropped our attribute, fall back to stable role +
 * accessible name, re-tag the fresh node with the ORIGINAL nonce, and
 * verify uniqueness before returning. This eliminates the flake where
 * the pre-open locator becomes detached after dialog close.
 */
export async function relocateInstallTrigger(
  page: Page,
  captured: CapturedTrigger,
): Promise<Locator> {
  const nonceSelector = `[${TRIGGER_NONCE_ATTR}="${captured.nonce}"]`;
  const byNonce = page.locator(nonceSelector);
  if ((await byNonce.count()) === 1) {
    const matched = await byNonce.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      ariaLabel: el.getAttribute("aria-label"),
      text: (el.textContent || "").trim().slice(0, 60),
      outerHTML: el.outerHTML.slice(0, 400),
    }));
    await page.evaluate(
      (entry) => {
        (window as unknown as { __ipRelocate: unknown }).__ipRelocate = entry;
        const w = window as unknown as { __ipFocusHistory?: unknown[] };
        w.__ipFocusHistory = w.__ipFocusHistory || [];
        w.__ipFocusHistory.push({ at: Date.now(), perf: performance.now(), event: "relocate", ...entry });
      },
      { path: "nonce", usedFallback: false, selector: nonceSelector, nonce: captured.nonce, matched },
    );
    return byNonce;
  }

  const nameRegexSrc = `/${dict.en["install.title"]}/`;
  const fresh = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(fresh).toHaveCount(1);
  await expect(fresh).toBeVisible();
  await fresh.evaluate(
    (el, args) => el.setAttribute(args.attr, args.n),
    { attr: TRIGGER_NONCE_ATTR, n: captured.nonce },
  );
  const rebound = page.locator(nonceSelector);
  await expect(rebound).toHaveCount(1);
  const matched = await rebound.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    ariaLabel: el.getAttribute("aria-label"),
    text: (el.textContent || "").trim().slice(0, 60),
    outerHTML: el.outerHTML.slice(0, 400),
  }));
  await page.evaluate(
    (entry) => {
      (window as unknown as { __ipRelocate: unknown }).__ipRelocate = entry;
      const w = window as unknown as { __ipFocusHistory?: unknown[] };
      w.__ipFocusHistory = w.__ipFocusHistory || [];
      w.__ipFocusHistory.push({ at: Date.now(), perf: performance.now(), event: "relocate", ...entry });
    },
    {
      path: "role-name-fallback",
      usedFallback: true,
      roleName: nameRegexSrc,
      finalSelector: nonceSelector,
      nonce: captured.nonce,
      matched,
    },
  );
  return rebound;
}


/** Reset the in-page focus-transition history buffer. */
export async function resetFocusHistory(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __ipFocusHistory: unknown[] }).__ipFocusHistory = [];
  });
}

// In-page describe fn: activeElement + dialog focusable stats used in
// every history entry so each checkpoint carries enough context to
// diagnose the escape without cross-referencing other entries.
const FOCUS_DESCRIBE_FN = `(el) => {
  const dlg = document.querySelector('[role="dialog"]');
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusables = dlg ? Array.from(dlg.querySelectorAll(sel)) : [];
  const labelOf = (n) => (n.getAttribute('aria-label') || (n.textContent||'').trim() || n.tagName.toLowerCase()).slice(0,60);
  return {
    active: el ? {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      dataTestid: el.getAttribute('data-testid'),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      name: el.getAttribute('name'),
      text: (el.textContent || '').trim().slice(0, 60),
      insideDialog: !!dlg?.contains(el),
      outerHTML: (el.outerHTML || '').slice(0, 800),
    } : null,
    focusableElementsCount: focusables.length,
    firstFocusableLabels: focusables.slice(0, 6).map(labelOf),
  };
}`;


/**
 * Press a key, recording before/after activeElement into
 * `window.__ipFocusHistory`. `expectFocusInsideDialog` surfaces the
 * buffer as `focusHistory` in the JSON dump so every transition that
 * led up to a focus-trap escape is visible.
 */
export async function pressAndRecord(page: Page, key: string) {
  await page.evaluate(
    ({ k, fnSrc }) => {
      const describe = eval(`(${fnSrc})`) as (el: Element | null) => unknown;
      const w = window as unknown as { __ipFocusHistory?: unknown[] };
      w.__ipFocusHistory = w.__ipFocusHistory || [];
      w.__ipFocusHistory.push({
        at: Date.now(),
        perf: performance.now(),
        event: `press:${k}`,
        before: describe(document.activeElement),
      });
    },
    { k: key, fnSrc: FOCUS_DESCRIBE_FN },
  );
  await page.keyboard.press(key);
  await page.evaluate(
    ({ k, fnSrc }) => {
      const describe = eval(`(${fnSrc})`) as (el: Element | null) => unknown;
      const w = window as unknown as { __ipFocusHistory?: unknown[] };
      (w.__ipFocusHistory as unknown[]).push({
        at: Date.now(),
        perf: performance.now(),
        event: `after:${k}`,
        after: describe(document.activeElement),
      });
    },
    { k: key, fnSrc: FOCUS_DESCRIBE_FN },
  );
}

/** Record a labeled focus checkpoint (e.g. "iter-1-after-close"). */
export async function noteFocus(page: Page, label: string) {
  await page.evaluate(
    ({ l, fnSrc }) => {
      const describe = eval(`(${fnSrc})`) as (el: Element | null) => unknown;
      const w = window as unknown as { __ipFocusHistory?: unknown[] };
      w.__ipFocusHistory = w.__ipFocusHistory || [];
      w.__ipFocusHistory.push({
        at: Date.now(),
        perf: performance.now(),
        event: `note:${l}`,
        snapshot: describe(document.activeElement),
      });
    },
    { l: label, fnSrc: FOCUS_DESCRIBE_FN },
  );
}


