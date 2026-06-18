import { isValidSlug } from "./lib/validate-slug.js";

const DEFAULTS = { openMode: "home", defaultSlug: "", debug: false };

const form = document.getElementById("settings");
const slugInput = document.getElementById("defaultSlug");
const slugError = document.getElementById("slugError");
const debugInput = document.getElementById("debug");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

function currentMode() {
  const checked = form.querySelector('input[name="openMode"]:checked');
  return checked ? checked.value : "home";
}

function validate() {
  const mode = currentMode();
  const slug = slugInput.value.trim();
  slugInput.disabled = mode !== "slug";

  let valid = true;
  let showError = false;

  if (mode === "slug") {
    if (!slug) {
      valid = false;
    } else if (!isValidSlug(slug)) {
      valid = false;
      showError = true;
    }
  }

  slugError.hidden = !showError;
  saveBtn.disabled = !valid;
  return valid;
}

chrome.storage.sync.get(DEFAULTS, (settings) => {
  const mode = settings.openMode || "home";
  const radio = form.querySelector(`input[name="openMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  else form.querySelector('input[name="openMode"][value="home"]').checked = true;
  slugInput.value = settings.defaultSlug || "";
  debugInput.checked = !!settings.debug;
  validate();
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
  chrome.storage.sync.set(
    {
      openMode: mode,
      defaultSlug: mode === "slug" ? slug : "",
      debug: !!debugInput.checked,
    },
    () => {
      if (chrome.runtime.lastError) {
        status.textContent = "✗ Save failed";
        return;
      }
      status.textContent = "✓ Saved";
      setTimeout(() => {
        if (status.textContent === "✓ Saved") status.textContent = "";
      }, 2500);
    },
  );
});
