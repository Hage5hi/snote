import "@testing-library/jest-dom";

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
const _origGetContext = HTMLCanvasElement.prototype.getContext;
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
  return (_origGetContext as (...a: any[]) => any).call(this, contextId, ...args);
} as typeof _origGetContext;
