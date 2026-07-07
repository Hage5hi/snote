// E2E: parameterized — each readiness field individually broken must
// keep PwaUpdateDebugPanel unmounted. Panel only mounts on a fully valid
// object.
import { test, expect } from "@playwright/test";

type State = Record<string, unknown>;
const validState: State = {
  currentBuildId: "build-A",
  pendingBuildId: "build-B",
  updateAvailable: true,
  updateInProgress: false,
  reloadAttemptCount: 0,
  reloadStrategy: "hard",
  lastRemoteBuildId: "build-B",
};

// Break one field at a time. `undefined` means the field is deleted;
// anything else is coerced to a bad shape.
const brokenPerField: Array<{ field: keyof typeof validState; value: unknown }> = [
  { field: "currentBuildId", value: undefined },
  { field: "currentBuildId", value: 123 },
  { field: "pendingBuildId", value: {} },
  { field: "updateAvailable", value: "yes" },
  { field: "reloadAttemptCount", value: "one" },
  { field: "reloadStrategy", value: "teleport" },
];

for (const { field, value } of brokenPerField) {
  test(`panel stays unmounted when '${String(field)}' is invalid (${JSON.stringify(value)})`, async ({ page }) => {
    await page.addInitScript(
      ({ base, f, v }) => {
        const s = { ...(base as object) } as Record<string, unknown>;
        if (v === undefined) delete s[f as string];
        else s[f as string] = v;
        (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = s;
      },
      { base: validState, f: field as string, v: value },
    );
    await page.goto("/");
    await page.waitForTimeout(1_200);
    // NOTE: current PwaUpdateDebugPanel only requires the object to be
    // truthy — this spec locks in the *desired* stricter behaviour and
    // will guide us to tighten the validator. If the panel currently
    // renders under partial validity, this asserts the tighter contract.
    // Skipping until validator is tightened would hide the gap; instead
    // we assert count == 0 and let the failure drive the fix.
    await expect(page.locator("[data-pwa-debug-panel='true']")).toHaveCount(0);
  });
}

test("panel mounts only when every field is valid", async ({ page }) => {
  await page.addInitScript((s) => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = s;
  }, validState);
  await page.goto("/");
  await expect(page.locator("[data-pwa-debug-panel='true']")).toHaveCount(1, { timeout: 3_000 });
});
