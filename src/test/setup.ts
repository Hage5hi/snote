import "@testing-library/jest-dom";

// Capability `import()` loaders sit behind a compile-time
// `VITE_CAPABILITY_ROUTES_ENABLED === "true"` ternary so production DCE can
// drop those chunks. Vitest evaluates that ternary at module load from the
// live `import.meta.env` object. Default the canary on so tests that mock
// `@/lib/capability/client` still reach the import(); fail-closed POST tests
// keep mutating the flag inside `createCapabilityApi()`.
const env = import.meta.env as Record<string, unknown>;
if (env.VITE_CAPABILITY_ROUTES_ENABLED === undefined) {
  env.VITE_CAPABILITY_ROUTES_ENABLED = "true";
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // jsdom inherits the host's CPU count. Set a realistic value so that
  // SceneHost's hardwareConcurrency guard (< 4 → block) does not trip.
  Object.defineProperty(navigator, "hardwareConcurrency", {
    value: 8,
    configurable: true,
  });

  // jsdom does not support WebGL canvas contexts. Stub getContext so that
  // SceneHost's hasWebGL() probe succeeds (mirroring a real browser).
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    contextId: string,
    ...args: unknown[]
  ) {
    if (
      contextId === "webgl" ||
      contextId === "webgl2" ||
      contextId === "experimental-webgl"
    ) {
      return {
        getExtension: () => ({ loseContext: () => {} }),
      } as unknown as RenderingContext;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalGetContext as (...a: any[]) => any).call(this, contextId, ...args);
  } as typeof originalGetContext;
}
