import { isValidSlug } from "./lib/validate-slug.js";
import { clearTelemetry } from "./lib/telemetry.js";

const DEFAULTS = { openMode: "home", defaultSlug: "", debug: false };
const TELEMETRY_KEY = "syrin:telemetryEnabled";

// Wire up the options form. Exported so tests can call it after mocking
// chrome.storage. Returns nothing — DOM state is the source of truth.
export function initOptions() {
  const form = document.getElementById("settings");
  const slugInput = document.getElementById("defaultSlug");
  const slugError = document.getElementById("slugError");
  const debugInput = document.getElementById("debug");
  const telemetryInput = document.getElementById("telemetryEnabled");
  const clearDiagnosticsBtn = document.getElementById("clearDiagnostics");
  const saveBtn = document.getElementById("save");
  const status = document.getElementById("status");

  const currentMode = () => {
    const checked = form.querySelector('input[name="openMode"]:checked');
    return checked ? checked.value : "home";
  };

  const validate = () => {
    const mode = currentMode();
    const slug = slugInput.value.trim();
    slugInput.disabled = loading || mode !== "slug";

    let valid = true;
    let showError = false;
    if (mode === "slug") {
      if (!slug) valid = false;
      else if (!isValidSlug(slug)) {
        valid = false;
        showError = true;
      }
    }
    slugError.hidden = !showError;
    saveBtn.disabled = loading || !valid;
    return valid;
  };

  // Loading gate: chrome.storage callbacks are asynchronous and can land
  // arbitrarily late. Until BOTH the synced settings and the local telemetry
  // preference have loaded, the whole form stays inert (disabled fieldsets
  // ship in the markup itself, so a JS or storage failure before init also
  // leaves the page fail-closed). A late storage callback can never
  // overwrite values the user already entered. If either read fails, the
  // form never becomes ready: a visible, announced error asks for a reload,
  // and Save cannot overwrite preferences from an unread initial state.
  // E2E waits on data-settings-ready="true" — deterministic, never a sleep.
  let loading = true;
  let loadFailed = false;
  let syncLoaded = false;
  let telemetryLoaded = !telemetryInput;
  const radios = Array.from(form.querySelectorAll('input[name="openMode"]'));
  const fieldsets = Array.from(form.querySelectorAll("fieldset"));
  const loadError = document.getElementById("loadError");

  const applyLoadingState = () => {
    form.setAttribute("data-settings-ready", loading ? "false" : "true");
    form.setAttribute("aria-busy", loading ? "true" : "false");
    for (const fieldset of fieldsets) fieldset.disabled = loading;
    for (const control of [...radios, debugInput, telemetryInput, clearDiagnosticsBtn]) {
      if (control) control.disabled = loading;
    }
    saveBtn.disabled = loading;
  };

  const failLoading = () => {
    if (loadFailed) return;
    loadFailed = true;
    if (loadError) loadError.hidden = false;
  };

  const maybeFinishLoading = () => {
    if (loadFailed || !loading || !syncLoaded || !telemetryLoaded) return;
    loading = false;
    applyLoadingState();
    validate();
  };

  applyLoadingState();
  // validate() also applies the loading-aware disabled states for the slug
  // input and the save button.
  validate();

  chrome.storage.sync.get(DEFAULTS, (settings) => {
    syncLoaded = true;
    if (chrome.runtime.lastError) {
      // Never fall back to defaults as if they were the user's stored
      // settings — the initial state is unknown, so nothing may be saved.
      failLoading();
      return;
    }
    const mode = settings.openMode || "home";
    const radio = form.querySelector(`input[name="openMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    else form.querySelector('input[name="openMode"][value="home"]').checked = true;
    slugInput.value = settings.defaultSlug || "";
    debugInput.checked = !!settings.debug;
    validate();
    maybeFinishLoading();
  });

  // Telemetry opt-in lives in local storage — device-scoped, never synced.
  if (telemetryInput) {
    chrome.storage.local.get({ [TELEMETRY_KEY]: false }, (s) => {
      telemetryLoaded = true;
      if (chrome.runtime.lastError) {
        // An unread preference must not render as a confirmed "off".
        failLoading();
        return;
      }
      telemetryInput.checked = !!s?.[TELEMETRY_KEY];
      maybeFinishLoading();
    });
  }

  clearDiagnosticsBtn?.addEventListener("click", async () => {
    clearDiagnosticsBtn.disabled = true;
    const cleared = await clearTelemetry();
    status.textContent = cleared
      ? "✓ Diagnostics cleared"
      : "✗ Clear failed";
    clearDiagnosticsBtn.disabled = false;
  });

  form.addEventListener("change", () => {
    status.textContent = "";
    validate();
  });
  slugInput.addEventListener("input", () => {
    status.textContent = "";
    validate();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (loading || !validate()) return;
    const mode = currentMode();
    const slug = slugInput.value.trim();
    const syncedSettings = {
      openMode: mode,
      defaultSlug: mode === "slug" ? slug : "",
      debug: !!debugInput.checked,
    };

    const saveSyncedSettings = () => {
      chrome.storage.sync.set(syncedSettings, () => {
        if (chrome.runtime.lastError) {
          status.textContent = "✗ Save failed";
          return;
        }
        status.textContent = "✓ Saved";
        setTimeout(() => {
          if (status.textContent === "✓ Saved") status.textContent = "";
        }, 2500);
      });
    };

    // The telemetry preference is device-local and must remain writable even
    // when Chrome Sync is unavailable. Persist it before the independent sync
    // write instead of nesting it in the sync-success callback.
    if (telemetryInput) {
      const telemetryEnabled = !!telemetryInput.checked;
      chrome.storage.local.set(
        { [TELEMETRY_KEY]: telemetryEnabled },
        async () => {
          if (chrome.runtime.lastError) {
            status.textContent = "✗ Save failed";
            return;
          }
          if (!telemetryEnabled && !await clearTelemetry()) {
            status.textContent = "✗ Save failed";
            return;
          }
          saveSyncedSettings();
        },
      );
    } else {
      saveSyncedSettings();
    }
  });
}

// Auto-init when loaded as a normal script in the extension page.
// In tests, callers import { initOptions } and call it after DOM mount.
if (typeof document !== "undefined" && document.getElementById("settings")) {
  initOptions();
}
