// Chrome-specific message listener wrapper
// Import shared background logic and register Chrome-style listener

// Chrome uses sendResponse callback pattern
importScripts("background.shared.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});
