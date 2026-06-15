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

// Keyboard shortcut (Alt+S by default) opens the side panel in the current
// window. Listener runs inside a user-gesture context, which is required by
// chrome.sidePanel.open().
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-side-panel") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.error("[syrin-note] open side panel failed", err);
  }
});
