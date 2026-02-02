// Firefox-specific message listener wrapper
// Firefox with browser.* API expects Promise return from listener

// Load shared background logic
importScripts("background.shared.js");

// Firefox expects the listener to return a Promise directly
browser.runtime.onMessage.addListener((message, sender) => {
  return handleMessage(message, sender);
});
