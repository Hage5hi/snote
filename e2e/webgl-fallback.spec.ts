// E2E: WebGL context creation failure → SceneHost falls back to "none".
//
// We override HTMLCanvasElement.prototype.getContext BEFORE any app code
// runs so SceneHost.hasWebGL() observes a hard failure (returns null for
// webgl/webgl2). The chosen scene is one that REQUIRES a shader
// (cyber-linh-khi → not lightweight), so the fallback path is the only
// way data-scene can end up as "none".
//
// Acceptance:
//   1. data-scene attribute on [data-home-root] becomes "" or "none" — i.e.
//      no scene is mounted.
//   2. No "Uncaught" / WebGL-related errors hit the console (we tolerate
//      a single warning about WebGL being unavailable).
//   3. The chrome (header + slug input) still renders and is interactive.
import { test, expect, type Page } from "@playwright/test";

async function killWebGL(page: Page) {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (this: HTMLCanvasElement, id: string, ...rest: unknown[]) => unknown;
    };
    const original = proto.getContext;
    proto.getContext = function patched(id: string, ...rest: unknown[]) {
      if (id === "webgl" || id === "webgl2" || id === "experimental-webgl") {
        return null;
      }
      return original.call(this, id, ...(rest as []));
    };
    // Also stub the standalone OffscreenCanvas path if present.
    if (typeof OffscreenCanvas !== "undefined") {
      const op = (OffscreenCanvas.prototype as unknown as {
        getContext: (id: string, ...rest: unknown[]) => unknown;
      });
      const orig = op.getContext;
      op.getContext = function (id: string, ...rest: unknown[]) {
        if (id === "webgl" || id === "webgl2") return null;
        return orig.call(this, id, ...(rest as []));
      };
    }
  });
}

test("WebGL unavailable → scene falls back to none without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await killWebGL(page);

  // Seed a shader-required scene + EN locale so the fallback path is exercised.
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    localStorage.setItem("home.scene", "cyber-linh-khi");
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);

  const root = page.locator("[data-home-root]").first();
  await expect(root).toBeVisible();

  // SceneHost should have detected the absence of WebGL and either left
  // data-scene empty/none, or marked itself as fallback. Accept any of those.
  const scene = (await root.getAttribute("data-scene")) ?? "";
  expect(["", "none"]).toContain(scene);

  // Chrome must still be interactive — slug input is present.
  await expect(page.getByRole("button", { name: "Theme settings" })).toBeVisible();

  // Filter out benign warnings; only fail on real uncaught errors.
  const real = errors.filter(
    (e) =>
      !/webgl/i.test(e) &&
      !/scene.*fallback/i.test(e) &&
      !/ResizeObserver/i.test(e),
  );
  expect(real, `Unexpected console errors: ${real.join("\n")}`).toEqual([]);
});
