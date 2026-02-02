// Chrome-specific browser APIs and implementations

export const tabsApi = chrome.tabs;
export const runtimeApi = chrome.runtime;
export const devtoolsApi = chrome.devtools;
export const storageApi = chrome.storage;
export const cookiesApi = chrome.cookies;
export const permissionsApi = chrome.permissions;

export const getInspectedTabUrl = async () => {
  try {
    const tabId = devtoolsApi.inspectedWindow.tabId;
    if (!tabId) return "";
    const tab = await tabsApi.get(tabId);
    return tab?.url || "";
  } catch {
    return "";
  }
};

export const setupTabListeners = (onTabUpdated, onTabActivated) => {
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
  // Chrome needs storage listener to refresh when cookies change
  storageApi.onChanged.addListener(() => {
    onStorageChanged();
  });
};
