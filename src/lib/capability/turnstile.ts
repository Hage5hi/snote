export interface TurnstileTokenSource {
  token(): Promise<string | null>;
}

export type TurnstileSourceOptions = {
  siteKey: string;
  windowLike?: Window;
  documentLike?: Document;
  timeoutMs?: number;
};

const SCRIPT_ID = "snote-turnstile-api";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 290_000;

type TurnstileWidgetId = string | number;

type TurnstileConfiguration = {
  sitekey: string;
  execution: "execute";
  appearance: "interaction-only";
  callback(token: string): void;
  "error-callback"(...args: unknown[]): void;
  "expired-callback"(): void;
  "timeout-callback"(): void;
};

type TurnstileApi = {
  render(host: HTMLElement, configuration: TurnstileConfiguration): TurnstileWidgetId;
  execute(widgetId: TurnstileWidgetId): void;
  remove(widgetId: TurnstileWidgetId): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptLoads = new WeakMap<Document, Promise<boolean>>();

function loadTurnstile(
  windowLike: Window,
  documentLike: Document,
  timeoutMs: number,
): Promise<boolean> {
  if (windowLike.turnstile) return Promise.resolve(true);

  const cached = scriptLoads.get(documentLike);
  if (cached) return cached;

  const promise = new Promise<boolean>((resolve) => {
    let script: HTMLScriptElement;
    try {
      const existing = documentLike.getElementById(SCRIPT_ID);
      script = existing instanceof HTMLScriptElement
        ? existing
        : documentLike.createElement("script");
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
      if (!available) {
        try {
          script.remove();
        } catch {
          // A stale loader may already have been detached.
        }
      }
      resolve(available);
    };
    const loaded = () => finish(Boolean(windowLike.turnstile));
    const failed = () => finish(false);
    const loadTimer = setTimeout(failed, timeoutMs);

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });

    if (script.id === SCRIPT_ID) {
      const readyState = (script as HTMLScriptElement & { readyState?: string }).readyState;
      if (readyState === "complete" || readyState === "loaded") finish(false);
      return;
    }

    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;

    try {
      const parent = documentLike.head ?? documentLike.documentElement;
      if (!parent) {
        finish(false);
        return;
      }
      parent.appendChild(script);
    } catch {
      finish(false);
    }
  });

  scriptLoads.set(documentLike, promise);
  void promise.then((available) => {
    if (!available && scriptLoads.get(documentLike) === promise) {
      scriptLoads.delete(documentLike);
    }
  });
  return promise;
}

function removeHost(host: HTMLElement): void {
  try {
    host.remove();
  } catch {
    try {
      host.parentNode?.removeChild(host);
    } catch {
      // Cleanup is best-effort after the result has already been contained.
    }
  }
}

export function createTurnstileTokenSource(
  options: TurnstileSourceOptions,
): TurnstileTokenSource {
  return {
    async token(): Promise<string | null> {
      const windowLike = options.windowLike
        ?? (typeof window === "undefined" ? undefined : window);
      const documentLike = options.documentLike
        ?? (typeof document === "undefined" ? undefined : document);

      if (!options.siteKey || !windowLike || !documentLike) return null;

      let loaded: boolean;
      try {
        loaded = await loadTurnstile(
          windowLike,
          documentLike,
          options.timeoutMs ?? TOKEN_TIMEOUT_MS,
        );
      } catch {
        return null;
      }
      const turnstile = windowLike.turnstile;
      if (!loaded || !turnstile) return null;

      let host: HTMLElement;
      try {
        host = documentLike.createElement("div");
        host.setAttribute("role", "dialog");
        host.setAttribute("aria-label", "Security verification");
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.zIndex = "2147483647";
        documentLike.body.appendChild(host);
      } catch {
        return null;
      }

      return new Promise<string | null>((resolve) => {
        let widgetId: TurnstileWidgetId | undefined;
        let settled = false;
        let cleanupPending = false;

        const cleanup = () => {
          if (widgetId === undefined) {
            cleanupPending = true;
            return;
          }
          try {
            turnstile.remove(widgetId);
          } catch {
            // Turnstile cleanup must not expose SDK errors.
          }
          removeHost(host);
        };

        const settle = (token: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(token);
        };

        const timer = setTimeout(() => settle(null), options.timeoutMs ?? TOKEN_TIMEOUT_MS);

        try {
          widgetId = turnstile.render(host, {
            sitekey: options.siteKey,
            execution: "execute",
            appearance: "interaction-only",
            callback: (token) => settle(token || null),
            "error-callback": () => settle(null),
            "expired-callback": () => settle(null),
            "timeout-callback": () => settle(null),
          });

          if (cleanupPending) {
            try {
              turnstile.execute(widgetId);
            } finally {
              cleanup();
            }
            return;
          }
          turnstile.execute(widgetId);
        } catch {
          if (widgetId === undefined) removeHost(host);
          settle(null);
        }
      });
    },
  };
}
