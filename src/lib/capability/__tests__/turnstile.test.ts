import { afterEach, describe, expect, it, vi } from "vitest";

import { createTurnstileTokenSource } from "../turnstile";

type TurnstileCallbacks = {
  callback(token: string): void;
  "error-callback"(): void;
  "expired-callback"(): void;
  "timeout-callback"(): void;
};

function turnstileHarness(options: { loaded?: boolean } = {}) {
  const documentLike = document.implementation.createHTMLDocument("turnstile");
  const callbacks: TurnstileCallbacks[] = [];
  const render = vi.fn((_host: HTMLElement, configuration: TurnstileCallbacks) => {
    callbacks.push(configuration);
    return `widget-${callbacks.length}`;
  });
  const execute = vi.fn();
  const remove = vi.fn();
  const api = { render, execute, remove };
  const windowLike = (options.loaded === false ? {} : { turnstile: api }) as Window;
  const appendedScripts: HTMLScriptElement[] = [];
  const originalAppend = documentLike.head.appendChild.bind(documentLike.head);

  vi.spyOn(documentLike.head, "appendChild").mockImplementation((node) => {
    const appended = originalAppend(node);
    if (node instanceof HTMLScriptElement) {
      appendedScripts.push(node);
      queueMicrotask(() => {
        Object.assign(windowLike, { turnstile: api });
        node.dispatchEvent(new Event("load"));
      });
    }
    return appended;
  });

  return {
    api,
    callbacks,
    document: documentLike,
    window: windowLike,
    appendedScripts,
  };
}

async function waitForRender(render: ReturnType<typeof vi.fn>, count = 1) {
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(count));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createTurnstileTokenSource", () => {
  it("loads the explicit script once and creates one widget per request", async () => {
    const harness = turnstileHarness({ loaded: false });
    const source = createTurnstileTokenSource({
      siteKey: "1x00000000000000000000AA",
      windowLike: harness.window,
      documentLike: harness.document,
    });

    const first = source.token();
    const second = source.token();
    await waitForRender(harness.api.render, 2);

    expect(harness.appendedScripts).toHaveLength(1);
    expect(harness.appendedScripts[0].id).toBe("snote-turnstile-api");
    expect(harness.appendedScripts[0].src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    );
    expect(harness.api.execute).toHaveBeenNthCalledWith(1, "widget-1");
    expect(harness.api.execute).toHaveBeenNthCalledWith(2, "widget-2");

    harness.callbacks[0].callback("captcha-one");
    harness.callbacks[1].callback("captcha-two");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "captcha-one",
      "captcha-two",
    ]);
  });

  it("returns a single-use token and removes the challenge host", async () => {
    const harness = turnstileHarness();
    const source = createTurnstileTokenSource({
      siteKey: "1x00000000000000000000AA",
      windowLike: harness.window,
      documentLike: harness.document,
    });

    const pending = source.token();
    await waitForRender(harness.api.render);
    const host = harness.api.render.mock.calls[0][0] as HTMLElement;

    expect(host.getAttribute("role")).toBe("dialog");
    expect(host.getAttribute("aria-label")).toBe("Security verification");
    expect(host.style.position).toBe("fixed");
    expect(harness.document.body.contains(host)).toBe(true);

    harness.callbacks[0].callback("captcha-token");
    harness.callbacks[0]["error-callback"]();

    await expect(pending).resolves.toBe("captcha-token");
    expect(harness.api.remove).toHaveBeenCalledOnce();
    expect(harness.api.remove).toHaveBeenCalledWith("widget-1");
    expect(harness.document.body.contains(host)).toBe(false);
  });

  it.each(["error-callback", "expired-callback", "timeout-callback"] as const)(
    "%s fails closed",
    async (callbackName) => {
      const harness = turnstileHarness();
      const source = createTurnstileTokenSource({
        siteKey: "1x00000000000000000000AA",
        windowLike: harness.window,
        documentLike: harness.document,
      });

      const pending = source.token();
      await waitForRender(harness.api.render);
      harness.callbacks[0][callbackName]();

      await expect(pending).resolves.toBeNull();
      expect(harness.api.remove).toHaveBeenCalledWith("widget-1");
      expect(harness.document.body.children).toHaveLength(0);
    },
  );

  it("fails closed and cleans up when the local timeout elapses", async () => {
    vi.useFakeTimers();
    const harness = turnstileHarness();
    const source = createTurnstileTokenSource({
      siteKey: "1x00000000000000000000AA",
      windowLike: harness.window,
      documentLike: harness.document,
      timeoutMs: 290_000,
    });

    const pending = source.token();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.api.render).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(290_000);

    await expect(pending).resolves.toBeNull();
    expect(harness.api.remove).toHaveBeenCalledWith("widget-1");
    expect(harness.document.body.children).toHaveLength(0);
  });

  it("returns null when configuration, DOM, or script loading is unavailable", async () => {
    const missingSiteKey = createTurnstileTokenSource({
      siteKey: "",
      windowLike: {} as Window,
      documentLike: {} as Document,
    });
    const missingDom = createTurnstileTokenSource({
      siteKey: "site-key",
      windowLike: {} as Window,
      documentLike: {} as Document,
    });
    const documentLike = document.implementation.createHTMLDocument("turnstile");
    vi.spyOn(documentLike.head, "appendChild").mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event("error")));
      return node;
    });
    const unavailableScript = createTurnstileTokenSource({
      siteKey: "site-key",
      windowLike: {} as Window,
      documentLike,
    });

    await expect(missingSiteKey.token()).resolves.toBeNull();
    await expect(missingDom.token()).resolves.toBeNull();
    await expect(unavailableScript.token()).resolves.toBeNull();
  });

  it("bounds a completed stale script load and allows a later retry", async () => {
    vi.useFakeTimers();
    const documentLike = document.implementation.createHTMLDocument("turnstile");
    const staleScript = documentLike.createElement("script");
    staleScript.id = "snote-turnstile-api";
    Object.defineProperty(staleScript, "readyState", { value: "complete" });
    documentLike.head.appendChild(staleScript);
    const windowLike = {} as Window;
    const source = createTurnstileTokenSource({
      siteKey: "1x00000000000000000000AA",
      windowLike,
      documentLike,
      timeoutMs: 1,
    });

    const pending = source.token();
    const bounded = Promise.race([
      pending,
      new Promise<"still-pending">((resolve) => {
        setTimeout(() => resolve("still-pending"), 10);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(bounded).resolves.toBeNull();
    expect(documentLike.getElementById("snote-turnstile-api")).toBeNull();

    const harness = turnstileHarness();
    const originalAppend = documentLike.head.appendChild.bind(documentLike.head);
    const append = vi.spyOn(documentLike.head, "appendChild").mockImplementation((node) => {
      const appended = originalAppend(node);
      if (node instanceof HTMLScriptElement) {
        queueMicrotask(() => {
          Object.assign(windowLike, { turnstile: harness.api });
          node.dispatchEvent(new Event("load"));
        });
      }
      return appended;
    });
    const retry = source.token();
    await vi.advanceTimersByTimeAsync(0);
    expect(append).toHaveBeenCalledOnce();
    expect(harness.api.render).toHaveBeenCalledOnce();
    harness.callbacks[0].callback("retry-token");
    await expect(retry).resolves.toBe("retry-token");
  });
});
