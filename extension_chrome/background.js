// Bấm biểu tượng extension thì mở Side Panel (Chrome và Edge 114+).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
