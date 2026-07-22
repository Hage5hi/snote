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
    slugInput.disabled = mode !== "slug";

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
    saveBtn.disabled = !valid;
    return valid;
  };

  chrome.storage.sync.get(DEFAULTS, (settings) => {
    const mode = settings.openMode || "home";
    const radio = form.querySelector(`input[name="openMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    else form.querySelector('input[name="openMode"][value="home"]').checked = true;
    slugInput.value = settings.defaultSlug || "";
    debugInput.checked = !!settings.debug;
    validate();
  });

  // Telemetry opt-in lives in local storage — device-scoped, never synced.
  if (telemetryInput) {
    chrome.storage.local.get({ [TELEMETRY_KEY]: false }, (s) => {
      telemetryInput.checked = chrome.runtime.lastError
        ? false
        : !!s?.[TELEMETRY_KEY];
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
    if (!validate()) return;
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
