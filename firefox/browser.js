// Firefox-specific browser APIs and implementations

export const tabsApi = browser.tabs;
export const runtimeApi = browser.runtime;
export const devtoolsApi = browser.devtools;
export const storageApi = browser.storage;
export const cookiesApi = browser.cookies;
// Firefox with <all_urls> permission doesn't need runtime permission checks
// Return a stub that always grants permission to avoid hanging
export const permissionsApi = {
  contains: async () => true,
  request: async () => true,
};

export const getInspectedTabUrl = async () => {
  try {
    // Firefox DevTools: browser.devtools.inspectedWindow.eval returns a Promise directly
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("timeout")), 2000)
    );
    const evalPromise = devtoolsApi.inspectedWindow.eval("window.location.href");
    const [result] = await Promise.race([evalPromise, timeoutPromise]);
    return result || "";
  } catch (e) {
    // On error or timeout, try to get URL from tabs API as fallback
    try {
      const tabId = devtoolsApi.inspectedWindow.tabId;
      if (tabId) {
        const tab = await tabsApi.get(tabId);
        return tab?.url || "";
      }
    } catch {
      // Ignore fallback errors
    }
    return "";
  }
};

export const setupTabListeners = (onTabUpdated, onTabActivated) => {
  // Firefox DevTools panels don't reliably support tabs API listeners
  // Disable them entirely to avoid issues - rely on manual refresh only
};

export const setupStorageListener = (onStorageChanged) => {
  // Firefox does NOT need storage listener - it causes race conditions
  // that clear the cookie list. COOKIE_HISTORY_UPDATED handles updates.
};
