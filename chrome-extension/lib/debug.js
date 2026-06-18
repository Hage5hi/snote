// Tiny debug logger shared across background/sidepanel. When debug=true in
// chrome.storage.sync, dlog() prints to console and notifies subscribers
// (used by the side panel debug bar). When false, it's a no-op.

const PREFIX = "[syrin-note][debug]";
let enabled = false;
const subscribers = new Set();

export function setDebug(value) {
  enabled = !!value;
}

export function isDebug() {
  return enabled;
}

export function onDebugLog(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function dlog(...args) {
  if (!enabled) return;
  try {
    console.log(PREFIX, ...args);
  } catch {
    /* ignore */
  }
  const line = {
    t: Date.now(),
    msg: args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" "),
  };
  for (const fn of subscribers) {
    try {
      fn(line);
    } catch {
      /* ignore */
    }
  }
}

// Hydrate from storage on load + react to settings changes.
export function initDebugFromStorage() {
  try {
    chrome.storage.sync.get({ debug: false }, (s) => setDebug(s.debug));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.debug) setDebug(changes.debug.newValue);
    });
  } catch {
    /* ignore — not in extension context (e.g. JSDOM test) */
  }
}
