// Safari-specific message listener wrapper
// Safari supports both chrome.* and browser.* APIs
// Uses Promise-based responses like Firefox

const browserApi = typeof browser !== "undefined" ? browser : chrome;

// Safari with Manifest V3 uses service workers like Chrome
// but supports Promise returns like Firefox
browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});
