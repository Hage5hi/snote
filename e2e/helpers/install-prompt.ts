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
    };
  }, TRIGGER_NONCE_ATTR);

  const payload = {
    label,
    testTitle: testInfo.title,
    triggerNonce: opts.triggerNonce ?? info.latestTriggerNonce,
    ...info,
  };


  if (!info.dialogContainsActive) {
    const fileName = `focus-trap-escape-${label}.json`;
    await testInfo.attach(fileName, {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
    // Also write to the test's outputDir so CI can list the exact path
    // per attempt/browser without parsing the JSON report.
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(testInfo.outputDir, { recursive: true });
      await fs.writeFile(
        path.join(testInfo.outputDir, fileName),
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
    await page.evaluate(
      (info) => {
        (window as unknown as { __ipRelocate: unknown }).__ipRelocate = info;
      },
      { path: "nonce", selector: nonceSelector, nonce: captured.nonce, at: Date.now() },
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
  await page.evaluate(
    (info) => {
      (window as unknown as { __ipRelocate: unknown }).__ipRelocate = info;
    },
    {
      path: "role-name-fallback",
      roleName: nameRegexSrc,
      finalSelector: nonceSelector,
      nonce: captured.nonce,
      at: Date.now(),
    },
  );
  return rebound;
}



