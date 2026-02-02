const STORAGE_KEYS = {
  historyMap: "cookieHistoryMap",
  currentMap: "cookieCurrentMap",
  alertKeys: "cookieAlertKeys",
  domainUrlMap: "cookieDomainUrlMap",
};

const MAX_HISTORY = 50;
const browserApi = globalThis.browser || globalThis.chrome;
const lastKnownTabUrl = new Map();
let lastKnownDomainUrl = new Map();

// Initialize domain URL map from storage on startup
(async () => {
  try {
    const data = await browserApi.storage.local.get([STORAGE_KEYS.domainUrlMap]);
    const storedMap = data[STORAGE_KEYS.domainUrlMap] || {};
    lastKnownDomainUrl = new Map(Object.entries(storedMap));
  } catch {
    // Ignore initialization errors
  }
})();

const normalizeDomain = (domain) =>
  domain?.startsWith(".") ? domain.slice(1) : domain || "";

// Don't include storeId in key - it's inconsistent between cookies.getAll and onChanged APIs
const cookieKey = (cookie) =>
  `${normalizeDomain(cookie.domain)}|${cookie.path}|${cookie.name}`;

const normalizeBase64 = (input) => {
  const sanitized = input
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLength = sanitized.length % 4;
  if (!padLength) return sanitized;
  return sanitized + "=".repeat(4 - padLength);
};

const tryParseJson = (input) => {
  try {
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
};

const decodeValue = (value) => {
  try {
    if (value == null) return { decoded: "", isDecoded: false, format: "raw" };
    if (typeof value !== "string") {
      return { decoded: String(value), isDecoded: false, format: "raw" };
    }
    if (value.startsWith("CfDJ")) {
      return { decoded: "", isDecoded: false, format: "encrypted" };
    }
    let decoded = value;
    let decodedBy = "raw";

    try {
      const urlDecoded = decodeURIComponent(decoded);
      if (urlDecoded !== decoded) {
        decoded = urlDecoded;
        decodedBy = "url";
      }
    } catch {
      // keep original if malformed
    }

    const normalizedBase64 = normalizeBase64(decoded);
    if (/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) {
      try {
        const base64Decoded = atob(normalizedBase64);
        if (base64Decoded) {
          decoded = base64Decoded;
          decodedBy = decodedBy === "raw" ? "base64" : `${decodedBy}+base64`;
        }
      } catch {
        // not valid base64
      }
    }

    const formattedJson = tryParseJson(decoded);
    if (formattedJson) {
      decoded = formattedJson;
      decodedBy = decodedBy === "raw" ? "json" : `${decodedBy}+json`;
    }

    const isDecoded = decodedBy !== "raw" || decoded !== value;
    return { decoded, isDecoded, format: decodedBy };
  } catch (e) {
    // If anything fails, return the raw value safely
    console.error("decodeValue error:", e, "for value:", value?.substring?.(0, 50));
    return { decoded: String(value ?? ""), isDecoded: false, format: "raw" };
  }
};

const getAlertKeys = async () => {
  const data = await browserApi.storage.local.get([STORAGE_KEYS.alertKeys]);
  return data[STORAGE_KEYS.alertKeys] || {};
};

const appendHistory = async (key, entry) => {
  const data = await browserApi.storage.local.get([STORAGE_KEYS.historyMap]);
  const historyMap = data[STORAGE_KEYS.historyMap] || {};
  const history = Array.isArray(historyMap[key]) ? historyMap[key] : [];
  history.unshift(entry);
  historyMap[key] = history.slice(0, MAX_HISTORY);
  await browserApi.storage.local.set({ [STORAGE_KEYS.historyMap]: historyMap });
  return historyMap[key];
};

const updateCurrent = async (key, entry) => {
  const data = await browserApi.storage.local.get([STORAGE_KEYS.currentMap]);
  const currentMap = data[STORAGE_KEYS.currentMap] || {};
  currentMap[key] = entry;
  await browserApi.storage.local.set({ [STORAGE_KEYS.currentMap]: currentMap });
};

const updateLastKnownUrl = async (tabId, url, domain) => {
  if (tabId && url) {
    lastKnownTabUrl.set(tabId, url);
  }
  if (domain && url) {
    const normalized = normalizeDomain(domain);
    lastKnownDomainUrl.set(normalized, url);
    // Persist to storage so it survives service worker restarts
    try {
      const storedMap = Object.fromEntries(lastKnownDomainUrl);
      await browserApi.storage.local.set({ [STORAGE_KEYS.domainUrlMap]: storedMap });
    } catch {
      // Ignore storage errors
    }
  }
};

const getLastKnownUrlForCookie = async (cookie) => {
  const normalized = normalizeDomain(cookie.domain);
  // First check in-memory map
  if (lastKnownDomainUrl.has(normalized)) {
    return lastKnownDomainUrl.get(normalized);
  }
  // Try to get from storage (service worker may have restarted)
  try {
    const data = await browserApi.storage.local.get([STORAGE_KEYS.domainUrlMap]);
    const storedMap = data[STORAGE_KEYS.domainUrlMap] || {};
    if (storedMap[normalized]) {
      lastKnownDomainUrl.set(normalized, storedMap[normalized]);
      return storedMap[normalized];
    }
  } catch {
    // Ignore storage errors
  }
  return "";
};

const getTabContext = async (tabId) => {
  try {
    if (tabId) {
      const tab = await browserApi.tabs.get(tabId);
      return { url: tab?.url || "", storeId: tab?.cookieStoreId || "" };
    }
  } catch {
    // tabs.get may fail in some contexts - fall through to query
  }
  
  try {
    const tabs = await browserApi.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTab = tabs?.[0];
    return { url: activeTab?.url || "", storeId: activeTab?.cookieStoreId || "" };
  } catch {
    return { url: "", storeId: "" };
  }
};

browserApi.cookies.onChanged.addListener(async (changeInfo) => {
  const { cookie, removed, cause } = changeInfo;
  if (!cookie) return;

  // IMPORTANT: Skip "overwrite" and "expired_overwrite" removal events - these are intermediate events
  // Chrome fires "overwrite removed:true" then "explicit removed:false" when updating a cookie
  // We only want to track the final "explicit" event with the new value
  if (removed && (cause === "overwrite" || cause === "expired_overwrite")) {
    return;
  }

  const rawValue = removed ? "" : cookie.value;
  const decodedInfo = decodeValue(rawValue);
  const key = cookieKey(cookie);

  // Get previous value to detect actual changes
  const prevData = await browserApi.storage.local.get([STORAGE_KEYS.currentMap]);
  const currentMap = prevData[STORAGE_KEYS.currentMap] || {};
  const previousEntry = currentMap[key];
  const previousRawValue = previousEntry?.rawValue ?? null;
  const previousDecodedValue = previousEntry?.decodedValue ?? null;

  const sizeBytes = (cookie.name?.length || 0) + (rawValue?.length || 0);
  const cookieUrl = await getLastKnownUrlForCookie(cookie);
  const entry = {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    storeId: cookie.storeId,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
    expirationDate: cookie.expirationDate,
    priority: cookie.priority,
    sizeBytes,
    removed,
    cause,
    rawValue,
    decodedValue: decodedInfo.decoded,
    format: decodedInfo.format,
    url: cookieUrl,
    timestamp: Date.now(),
    previousDecodedValue: previousDecodedValue,
  };

  await updateCurrent(key, entry);

  // Get current history
  const histData = await browserApi.storage.local.get([STORAGE_KEYS.historyMap]);
  const historyMap = histData[STORAGE_KEYS.historyMap] || {};
  const existingHistory = historyMap[key] || [];
  
  // Only add to history if the value actually changed or cookie was removed
  const valueChanged = previousRawValue !== rawValue;
  const isNewCookie = previousRawValue === null && !removed;
  const hasNoHistory = existingHistory.length === 0;
  
  let updatedHistory = [];
  
  if (isNewCookie || (hasNoHistory && !removed)) {
    // Cookie was just created OR we have no history baseline
    // Create a "created" entry to record the initial baseline value
    const createdEntry = {
      ...entry,
      cause: "created",
      previousDecodedValue: null,
    };
    historyMap[key] = [createdEntry];
    await browserApi.storage.local.set({ [STORAGE_KEYS.historyMap]: historyMap });
    updatedHistory = historyMap[key];
  } else if (valueChanged || removed) {
    updatedHistory = await appendHistory(key, entry);
  } else {
    updatedHistory = existingHistory;
  }

  // Notify all devtools panels about the cookie change
  browserApi.runtime.sendMessage({
    type: "COOKIE_HISTORY_UPDATED",
    payload: { key, entry, history: updatedHistory },
  }).catch(() => {
    // Ignore errors when no listeners are available
  });

  const alertKeys = await getAlertKeys();
  if (!alertKeys[key]) return;

  if (browserApi.notifications?.create) {
    browserApi.notifications.create({
      type: "basic",
      iconUrl: "icons/cookie.svg",
      title: `Cookie changed: ${cookie.name}`,
      message: entry.url
        ? `${entry.url}\n${entry.decodedValue}`
        : entry.decodedValue,
    });
  }
});

// Handle messages from panel - using async handler that returns Promise for Firefox compatibility
// Using var so it's accessible globally when loaded via importScripts
var handleMessage = async (message, sender) => {
  if (message?.type === "CLEAR_COOKIE_HISTORY") {
    const { key } = message.payload || {};
    if (!key) {
      return { ok: false, error: "No key provided" };
    }
    
    try {
      const data = await browserApi.storage.local.get([STORAGE_KEYS.historyMap]);
      const historyMap = data[STORAGE_KEYS.historyMap] || {};
      delete historyMap[key];
      await browserApi.storage.local.set({ [STORAGE_KEYS.historyMap]: historyMap });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || "Failed" };
    }
  }
  
  if (message?.type === "GET_DECODED_COOKIES") {
    const requestedTabId = message.payload?.tabId;
    const senderTabId = sender?.tab?.id;
    const effectiveTabId = requestedTabId || senderTabId || null;

    try {
      const { url, storeId } = await getTabContext(effectiveTabId);
      
      let cookies = [];
      if (url) {
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname;
          
          // Use URL-based lookup first (works with per-site permissions)
          const urlCookies = await browserApi.cookies.getAll({ url });
          const cookieMap = new Map();
          for (const c of urlCookies) {
            cookieMap.set(`${c.domain}|${c.path}|${c.name}`, c);
          }
          
          // Also try domain-based lookups to catch any cookies URL lookup misses
          try {
            const domainCookies = await browserApi.cookies.getAll({ domain: hostname });
            for (const c of domainCookies) {
              cookieMap.set(`${c.domain}|${c.path}|${c.name}`, c);
            }
          } catch { /* ignore */ }
          
          // Try with dot prefix for parent domain cookies
          try {
            const dotDomainCookies = await browserApi.cookies.getAll({ domain: "." + hostname });
            for (const c of dotDomainCookies) {
              cookieMap.set(`${c.domain}|${c.path}|${c.name}`, c);
            }
          } catch { /* ignore */ }
          
          // Try parent domain if it's a subdomain (e.g., demo.example.com -> example.com)
          const parts = hostname.split(".");
          if (parts.length > 2) {
            const parentDomain = parts.slice(1).join(".");
            try {
              const parentCookies = await browserApi.cookies.getAll({ domain: parentDomain });
              for (const c of parentCookies) {
                cookieMap.set(`${c.domain}|${c.path}|${c.name}`, c);
              }
            } catch { /* ignore */ }
            try {
              const dotParentCookies = await browserApi.cookies.getAll({ domain: "." + parentDomain });
              for (const c of dotParentCookies) {
                cookieMap.set(`${c.domain}|${c.path}|${c.name}`, c);
              }
            } catch { /* ignore */ }
          }
          
          cookies = Array.from(cookieMap.values());
        } catch {
          // Fallback to URL-based lookup if parsing fails
          cookies = await browserApi.cookies.getAll({ url });
        }
      } else if (storeId) {
        cookies = await browserApi.cookies.getAll({ storeId });
      } else {
        cookies = await browserApi.cookies.getAll({});
      }
      
      const data = await browserApi.storage.local.get([
        STORAGE_KEYS.historyMap,
        STORAGE_KEYS.currentMap,
      ]);
      let historyMap = data[STORAGE_KEYS.historyMap] || {};
      let currentMap = data[STORAGE_KEYS.currentMap] || {};
      
      // Build set of current cookie keys
      const currentKeys = new Set();
      
      // Process each cookie individually with error handling so one bad cookie
      // doesn't break the entire list
      const decodedCookies = (await Promise.all(cookies.map(async (cookie) => {
        try {
          const rawValue = cookie.value ?? "";
          const decodedInfo = decodeValue(rawValue);
          const key = cookieKey(cookie);
          currentKeys.add(key);
          
          if (url) {
            await updateLastKnownUrl(effectiveTabId, url, cookie.domain);
          }
          const sizeBytes =
            (cookie.name?.length || 0) + (rawValue?.length || 0);
        
        const existingCurrent = currentMap[key];
        const existingHistory = historyMap[key] || [];
        
        // Update currentMap with the ACTUAL current value
        currentMap[key] = {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          storeId: cookie.storeId,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          hostOnly: cookie.hostOnly,
          session: cookie.session,
          expirationDate: cookie.expirationDate,
          priority: cookie.priority,
          sizeBytes,
          rawValue,
          decodedValue: decodedInfo.decoded,
          format: decodedInfo.format,
          url,
          timestamp: existingCurrent?.timestamp || Date.now(),
        };
        
        // ONLY create baseline if there's no history at all
        // Never touch existing history - let onChanged handle all changes
        if (existingHistory.length === 0 && rawValue) {
          historyMap[key] = [{
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            storeId: cookie.storeId,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            hostOnly: cookie.hostOnly,
            session: cookie.session,
            expirationDate: cookie.expirationDate,
            priority: cookie.priority,
            sizeBytes,
            removed: false,
            cause: "created",
            rawValue,
            decodedValue: decodedInfo.decoded,
            format: decodedInfo.format,
            url,
            timestamp: Date.now(),
            previousDecodedValue: null,
          }];
        }
        
        const history = historyMap[key] || [];
          return {
            key,
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            storeId: cookie.storeId,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            hostOnly: cookie.hostOnly,
            session: cookie.session,
            expirationDate: cookie.expirationDate,
            priority: cookie.priority,
            sizeBytes,
            rawValue,
            decodedValue: decodedInfo.decoded,
            format: decodedInfo.format,
            url,
            history,
            lastChanged: history[0]?.timestamp || null,
          };
        } catch (e) {
          // Log the error but don't fail - return a minimal cookie object
          console.error("Error processing cookie:", cookie?.name, e);
          const key = `${cookie?.domain || ""}|${cookie?.path || ""}|${cookie?.name || "unknown"}`;
          currentKeys.add(key);
          return {
            key,
            name: cookie?.name || "unknown",
            domain: cookie?.domain || "",
            path: cookie?.path || "/",
            storeId: cookie?.storeId,
            secure: cookie?.secure,
            httpOnly: cookie?.httpOnly,
            sameSite: cookie?.sameSite,
            hostOnly: cookie?.hostOnly,
            session: cookie?.session,
            expirationDate: cookie?.expirationDate,
            priority: cookie?.priority,
            sizeBytes: 0,
            rawValue: cookie?.value ?? "",
            decodedValue: cookie?.value ?? "",
            format: "raw",
            url,
            history: [],
            lastChanged: null,
          };
        }
      }))).filter(Boolean);

      // Clean up stale entries - remove currentMap and historyMap entries 
      // for cookies that no longer exist
      for (const key of Object.keys(currentMap)) {
        if (!currentKeys.has(key)) {
          delete currentMap[key];
          delete historyMap[key];
        }
      }
      for (const key of Object.keys(historyMap)) {
        if (!currentKeys.has(key)) {
          delete historyMap[key];
        }
      }

      // Persist updated maps
      await browserApi.storage.local.set({ 
        [STORAGE_KEYS.currentMap]: currentMap,
        [STORAGE_KEYS.historyMap]: historyMap,
      });

      return { ok: true, cookies: decodedCookies };
    } catch (error) {
      return { ok: false, error: error?.message || "Failed" };
    }
  }

  return { ok: false, error: "Unknown message" };
};

// Message listener is registered in browser-specific background.js files
// (chrome/background.js and firefox/background.js)
