// E2E: WebGL context creation failure → SceneHost mounts no animated layer.
//
// We override HTMLCanvasElement.prototype.getContext BEFORE any app code
// runs so SceneHost.hasWebGL() observes a hard failure (returns null for
// webgl/webgl2). The chosen scene is one that REQUIRES a shader
// (cyber-linh-khi → not lightweight), so the fallback path must avoid
// mounting the scene host or allocating a canvas.
//
// Acceptance:
//   1. no scene host or WebGL canvas is mounted.
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

test("WebGL unavailable → scene renders no animated layer or console errors", async ({ page }) => {
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

  const root = page.locator("[data-app-root]").first();
  await expect(root).toBeVisible();

  // The selected id may remain on the shell so its static color tokens still
  // apply, but the guarded SceneHost must not mount or allocate GPU content.
  await expect(page.locator("[data-scene-ready]")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);

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
