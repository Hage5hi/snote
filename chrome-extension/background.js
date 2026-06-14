// Open the side panel when the toolbar action is clicked.
// Wrapped in a try/catch + .catch so a missing API on older Chromium
// builds doesn't crash the service worker.
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error("[syrin-note] setPanelBehavior failed", err));
  } catch (err) {
    console.error("[syrin-note] sidePanel API unavailable", err);
  }
});
