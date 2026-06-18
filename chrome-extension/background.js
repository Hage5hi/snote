import { badgeForMode } from "./lib/build-src.js";
import { dlog, initDebugFromStorage } from "./lib/debug.js";

initDebugFromStorage();

const BADGE_BG = "#1e3a8a"; // watercolor navy

function applyBadge(openMode) {
  const text = badgeForMode(openMode);
  try {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    }
    chrome.action.setBadgeText({ text });
    dlog("badge set", text);
  } catch (err) {
    console.error("[syrin-note] applyBadge failed", err);
  }
}

function refreshBadgeFromStorage() {
  try {
    chrome.storage.sync.get({ openMode: "home" }, (settings) => {
      applyBadge(settings.openMode);
    });
  } catch (err) {
    console.error("[syrin-note] refreshBadgeFromStorage failed", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error("[syrin-note] setPanelBehavior failed", err));
  } catch (err) {
    console.error("[syrin-note] sidePanel API unavailable", err);
  }
  refreshBadgeFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  refreshBadgeFromStorage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.openMode) {
    applyBadge(changes.openMode.newValue ?? "home");
  }
});

// Alt+S → open side panel in current window.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-side-panel") return;
  try {
    let windowId = null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.windowId != null) {
      windowId = tab.windowId;
    } else {
      const win = await chrome.windows.getCurrent();
      windowId = win?.id ?? null;
    }
    if (windowId == null) {
      console.warn("[syrin-note] no window to open side panel in");
      return;
    }
    dlog("Alt+S → open side panel windowId=", windowId);
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    console.error("[syrin-note] open side panel failed", err?.message || err);
  }
});
