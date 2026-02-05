// Safari-specific browser APIs and implementations
// Safari supports both chrome.* and browser.* namespaces
// We use browser.* for consistency and Promise-based APIs

const browserApi = typeof browser !== "undefined" ? browser : chrome;

export const tabsApi = browserApi.tabs;
export const runtimeApi = browserApi.runtime;
export const devtoolsApi = browserApi.devtools;
export const storageApi = browserApi.storage;
export const cookiesApi = browserApi.cookies;
export const permissionsApi = browserApi.permissions;

export const getInspectedTabUrl = async () => {
  try {
    const tabId = devtoolsApi.inspectedWindow.tabId;
    if (!tabId) return "";
    const tab = await tabsApi.get(tabId);
    return tab?.url || "";
  } catch {
    // Safari may restrict access to certain URLs
    // Try eval as fallback
    try {
      const [result] = await devtoolsApi.inspectedWindow.eval("window.location.href");
      return result || "";
    } catch {
      return "";
    }
  }
};

export const setupTabListeners = (onTabUpdated, onTabActivated) => {
  // Safari supports tab listeners similar to Chrome
  tabsApi.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== devtoolsApi.inspectedWindow.tabId) return;
    if (changeInfo.status === "complete") {
      onTabUpdated();
    }
  });

  tabsApi.onActivated.addListener((activeInfo) => {
    if (activeInfo?.tabId !== devtoolsApi.inspectedWindow.tabId) return;
    onTabActivated();
  });
};

export const setupStorageListener = (onStorageChanged) => {
  // Safari supports storage change events
  storageApi.onChanged.addListener(() => {
    onStorageChanged();
  });
};
