// Asserts the emitted invalid-reason ordering matches the validator's
// fail-fast field evaluation sequence.
import { test, expect } from "@playwright/test";

// Order defined by explainPwaReadinessState in src/lib/pwa-update-readiness.ts.
const EVAL_ORDER = [
  "currentBuildId",
  "pendingBuildId",
  "updateAvailable",
  "updateInProgress",
  "reloadAttemptCount",
  "reloadStrategy",
  "lastRemoteBuildId",
  "lastAcceptedAt",
];

test("emitted invalid-field order matches validator evaluation sequence", async ({ page }) => {
  await page.goto("/");

  const observed = await page.evaluate((order) => {
    const seen: string[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent).detail.field);
    window.addEventListener("snote:pwa-readiness-invalid", handler);

    const base = {
      currentBuildId: "b1",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: null,
      lastAcceptedAt: null,
    };
    const bad: Record<string, unknown> = {
      currentBuildId: "",
      pendingBuildId: 5,
      updateAvailable: "yes",
      updateInProgress: 1,
      reloadAttemptCount: -1,
      reloadStrategy: "teleport",
      lastRemoteBuildId: 3,
      lastAcceptedAt: "now",
    };
    const explain = (
      window as unknown as { __SNOTE_PWA_READINESS_EXPLAIN__?: (v: unknown) => { field: string } | null }
    ).__SNOTE_PWA_READINESS_EXPLAIN__;
    if (!explain) return { seen, missing: true };

    for (const field of order) {
      const reason = explain({ ...base, [field]: bad[field] });
      if (reason) {
        window.dispatchEvent(new CustomEvent("snote:pwa-readiness-invalid", { detail: reason }));
      }
    }
    window.removeEventListener("snote:pwa-readiness-invalid", handler);
    return { seen, missing: false };
  }, EVAL_ORDER);

  expect(observed.missing).toBe(false);
  expect(observed.seen).toEqual(EVAL_ORDER);
});
