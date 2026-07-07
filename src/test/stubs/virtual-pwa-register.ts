// Test stub for the virtual:pwa-register module supplied at build time by
// vite-plugin-pwa. Overridden per-test via vi.mock("virtual:pwa-register", ...).
export function registerSW(_opts?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
