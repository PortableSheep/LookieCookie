import {
  tabsApi,
  runtimeApi,
  devtoolsApi,
  storageApi,
  cookiesApi,
  permissionsApi,
  getInspectedTabUrl,
  setupTabListeners,
  setupStorageListener,
} from "./browser.js";

const cookieList = document.getElementById("cookieList");
const cookieCount = document.getElementById("cookieCount");
const lastUpdate = document.getElementById("lastUpdate");
const refreshButton = document.getElementById("refreshButton");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const detailUrl = document.getElementById("detailUrl");
const detailInfo = document.getElementById("detailInfo");
const detailRaw = document.getElementById("detailRaw");
const detailCurrentDiff = document.getElementById("detailCurrentDiff");
const detailHistory = document.getElementById("detailHistory");
const changeIndicator = document.getElementById("changeIndicator");
const historyCount = document.getElementById("historyCount");
const toggleDiffBtn = document.getElementById("toggleDiffBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportJson = document.getElementById("exportJson");
const exportCsv = document.getElementById("exportCsv");
const donateButton = document.getElementById("donateButton");
const permissionModal = document.getElementById("permissionModal");
const permissionMessage = document.getElementById("permissionMessage");
const permissionGrantButton = document.getElementById(
  "permissionGrantButton",
);

let hostPermissionPromise = null;
let lastPermissionOrigin = "";
let lastPermissionGranted = false;

let cookiesCache = [];
let selectedKey = localStorage.getItem("selectedCookieKey") || "";
let showDiffMode = true; // true = show diff, false = show full value
let selectedCookieRef = null; // reference to currently selected cookie for toggle

const DONATE_URL = "https://buy.stripe.com/3cI28rcyn3PP8EoflY5Ne01";

let refreshTimer = null;
const scheduleRefresh = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refresh().catch(() => {
      // Only clear the list if we have no cached cookies (initial load)
      // Don't clear an existing list just because refresh failed
      if (cookiesCache.length === 0) {
        renderEmptyList();
        renderEmptyDetail();
      }
    });
  }, 120);
};

const highlightJson = (value) => {
  const fragment = document.createDocumentFragment();
  
  try {
    JSON.parse(value);
  } catch {
    fragment.appendChild(document.createTextNode(value));
    return fragment;
  }

  const tokenRegex = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = tokenRegex.exec(value)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }
    
    const span = document.createElement("span");
    span.textContent = match[0];
    
    if (match[1]) {
      span.className = "json-key";
    } else if (match[2]) {
      span.className = "json-string";
    } else if (match[3]) {
      span.className = "json-boolean";
    } else if (match[4]) {
      span.className = "json-null";
    } else if (match[5]) {
      span.className = "json-number";
    }
    
    fragment.appendChild(span);
    lastIndex = tokenRegex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
  
  return fragment;
};

const formatTime = (timestamp) => {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  // Show relative time for recent changes
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return date.toLocaleTimeString();
};

const formatFullTime = (timestamp) => {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
};

// Simple line-based diff for decoded values
const computeDiff = (oldValue, newValue) => {
  if (oldValue === newValue) return null;
  if (oldValue == null || oldValue === "") {
    return { type: "added", lines: [{ type: "add", text: newValue }] };
  }
  if (newValue == null || newValue === "") {
    return { type: "removed", lines: [{ type: "remove", text: oldValue }] };
  }

  const oldLines = oldValue.split("\n");
  const newLines = newValue.split("\n");
  const result = [];
  
  // Simple LCS-based diff for small values
  const maxLines = Math.max(oldLines.length, newLines.length);
  
  if (maxLines <= 50) {
    // Build a simple diff using longest common subsequence approach
    const lcs = [];
    const m = oldLines.length;
    const n = newLines.length;
    
    // Create DP table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // Backtrack to find diff
    let i = m, j = n;
    const diffOps = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diffOps.unshift({ type: "same", text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diffOps.unshift({ type: "add", text: newLines[j - 1] });
        j--;
      } else {
        diffOps.unshift({ type: "remove", text: oldLines[i - 1] });
        i--;
      }
    }
    
    // Collapse consecutive same lines if too many
    let sameCount = 0;
    for (const op of diffOps) {
      if (op.type === "same") {
        sameCount++;
        if (sameCount <= 2 || diffOps.indexOf(op) >= diffOps.length - 2) {
          result.push(op);
        } else if (sameCount === 3) {
          result.push({ type: "collapse", count: 1 });
        } else {
          // Update collapse count
          const lastOp = result[result.length - 1];
          if (lastOp?.type === "collapse") {
            lastOp.count++;
          }
        }
      } else {
        sameCount = 0;
        result.push(op);
      }
    }
  } else {
    // For very large values, just show removed/added
    result.push({ type: "remove", text: oldValue.substring(0, 500) + (oldValue.length > 500 ? "..." : "") });
    result.push({ type: "add", text: newValue.substring(0, 500) + (newValue.length > 500 ? "..." : "") });
  }
  
  return { type: "changed", lines: result };
};

const renderDiff = (diff) => {
  const container = document.createElement("div");
  container.className = "diff-view";
  
  if (!diff) {
    container.textContent = "(no changes)";
    return container;
  }
  
  for (const line of diff.lines) {
    const lineEl = document.createElement("div");
    lineEl.className = `diff-line diff-${line.type}`;
    
    if (line.type === "collapse") {
      lineEl.textContent = `... ${line.count} unchanged line${line.count > 1 ? "s" : ""} ...`;
    } else {
      const prefix = line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  ";
      lineEl.textContent = prefix + line.text;
    }
    
    container.appendChild(lineEl);
  }
  
  return container;
};

const formatBytes = (bytes) => {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const renderInfoPills = (cookie) => {
  detailInfo.replaceChildren();
  const info = [
    `Secure: ${cookie.secure ? "Yes" : "No"}`,
    `HttpOnly: ${cookie.httpOnly ? "Yes" : "No"}`,
    `SameSite: ${cookie.sameSite || "—"}`,
    `HostOnly: ${cookie.hostOnly ? "Yes" : "No"}`,
    `Session: ${cookie.session ? "Yes" : "No"}`,
    `Expires: ${cookie.session ? "Session" : new Date((cookie.expirationDate || 0) * 1000).toLocaleString()}`,
    `Priority: ${cookie.priority || "—"}`,
    `Size: ${formatBytes(cookie.sizeBytes)}`,
  ];

  info.forEach((text) => {
    const pill = document.createElement("span");
    pill.textContent = text;
    detailInfo.appendChild(pill);
  });
};

const exportData = (cookie, type) => {
  if (!cookie) return;
  const payload = {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    url: cookie.url,
    current: cookie.current,
    history: cookie.history || [],
  };

  if (type === "json") {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cookie.name}-history.json`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const rows = [
    ["timestamp", "reason", "url", "raw", "decoded"],
    ...(cookie.history || []).map((entry) => [
      new Date(entry.timestamp || 0).toISOString(),
      entry.removed ? "removed" : entry.cause || "changed",
      entry.url || "",
      entry.rawValue || "",
      entry.decodedValue || "",
    ]),
  ];

  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cookie.name}-history.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const renderEmptyList = () => {
  cookieList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "No cookies found for this tab yet.";
  cookieList.appendChild(empty);
};

const showPermissionOverlay = (url) => {
  if (!permissionModal) return;
  permissionMessage.textContent = url
    ? `Grant site access to read cookies for ${url}.`
    : "Grant site access to read cookies for this tab.";
  permissionModal.classList.remove("hidden");
};

const hidePermissionOverlay = () => {
  if (!permissionModal) return;
  permissionModal.classList.add("hidden");
};

const renderPermissionNeeded = (url) => {
  cookieList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = url
    ? `Grant site access to read cookies for ${url}.`
    : "Grant site access to read cookies for this tab.";
  cookieList.appendChild(empty);

  showPermissionOverlay(url);

  detailTitle.textContent = "Permission needed";
  detailMeta.textContent = "—";
  detailUrl.textContent = url || "—";
  detailInfo.replaceChildren();
  detailRaw.textContent = "—";
  detailCurrentDiff.innerHTML = "<pre>—</pre>";
  changeIndicator.textContent = "";
  changeIndicator.className = "change-indicator";
  historyCount.textContent = "";
  detailHistory.replaceChildren();
  const detailEmpty = document.createElement("div");
  detailEmpty.className = "empty";
  detailEmpty.textContent = "Click refresh to allow access for this site.";
  detailHistory.appendChild(detailEmpty);
};

const renderEmptyDetail = () => {
  selectedCookieRef = null;
  detailTitle.textContent = "Select a cookie";
  detailMeta.textContent = "—";
  detailUrl.textContent = "—";
  detailInfo.replaceChildren();
  detailRaw.textContent = "—";
  detailCurrentDiff.innerHTML = "<pre>—</pre>";
  changeIndicator.textContent = "";
  changeIndicator.className = "change-indicator";
  if (toggleDiffBtn) {
    toggleDiffBtn.style.display = "none";
  }
  historyCount.textContent = "0 changes";
  detailHistory.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "Select a cookie to view its history.";
  detailHistory.appendChild(empty);
};

const renderList = (cookies) => {
  cookieList.replaceChildren();
  cookieCount.textContent = cookies.length;
  lastUpdate.textContent = formatTime(Date.now());

  if (!cookies.length) {
    renderEmptyList();
    renderEmptyDetail();
    return;
  }

  cookies.forEach((cookie) => {
    const row = document.createElement("div");
    row.className = "list-row";
    if (cookie.key === selectedKey) {
      row.classList.add("active");
    }

    const lastChange = cookie.lastChanged || cookie.history?.[0]?.timestamp || cookie.current?.timestamp;
    const hasHistory = cookie.history?.length > 0;
    
    const cells = [
      cookie.name,
      cookie.domain,
      cookie.format,
      formatTime(lastChange),
    ];

    cells.forEach((value, index) => {
      const span = document.createElement("span");
      span.textContent = value || "—";
      // Highlight the last change cell if there's history
      if (index === 3 && hasHistory) {
        span.className = "has-changes";
        span.title = formatFullTime(lastChange);
      }
      row.appendChild(span);
    });

    row.addEventListener("click", () => {
      selectedKey = cookie.key;
      localStorage.setItem("selectedCookieKey", selectedKey);
      renderList(cookiesCache);
      renderDetail(cookie);
    });

    cookieList.appendChild(row);
  });

  const selectedCookie = cookies.find((cookie) => cookie.key === selectedKey);
  if (selectedCookie) {
    renderDetail(selectedCookie);
  } else {
    renderEmptyDetail();
  }
};

const renderCurrentValue = (cookie) => {
  const history = cookie.history || [];
  const latestEntry = history[0];
  const currentValue = cookie.decodedValue ?? "";
  
  detailCurrentDiff.replaceChildren();
  
  // Only show diff if we have a latest entry with a previous value that differs from current
  const hasPrevious = latestEntry && latestEntry.previousDecodedValue != null;
  const hasDiff = hasPrevious && latestEntry.previousDecodedValue !== currentValue;
  
  // Update toggle button state
  if (toggleDiffBtn) {
    toggleDiffBtn.textContent = showDiffMode ? "Diff" : "Full";
    toggleDiffBtn.classList.toggle("active", showDiffMode && hasDiff);
    toggleDiffBtn.style.display = hasDiff ? "" : "none";
  }
  
  if (showDiffMode && hasDiff) {
    // Show diff between previous and current
    const diff = computeDiff(latestEntry.previousDecodedValue, currentValue);
    detailCurrentDiff.appendChild(renderDiff(diff));
    changeIndicator.textContent = `Changed ${formatTime(latestEntry.timestamp)}`;
    changeIndicator.className = "change-indicator has-diff";
  } else {
    // Show full current value
    const pre = document.createElement("pre");
    pre.replaceChildren(highlightJson(currentValue));
    detailCurrentDiff.appendChild(pre);
    if (latestEntry) {
      changeIndicator.textContent = `Changed ${formatTime(latestEntry.timestamp)}`;
      changeIndicator.className = "change-indicator has-diff";
    } else {
      changeIndicator.textContent = "";
      changeIndicator.className = "change-indicator";
    }
  }
};

const renderDetail = (cookie) => {
  selectedCookieRef = cookie;
  detailTitle.textContent = cookie.name;
  detailMeta.textContent = `${cookie.domain} • ${cookie.path}`;
  detailUrl.textContent = cookie.url || "—";
  renderInfoPills(cookie);
  detailRaw.textContent = cookie.rawValue ?? "";
  
  const history = cookie.history || [];
  
  // Render current value (with or without diff based on toggle)
  renderCurrentValue(cookie);
  
  // Render history - skip index 0 since that change is shown in Current Value
  // This means we show the baseline "created" entry and all changes before the current one
  const pastHistory = history.length > 1 ? history.slice(1) : [];
  const totalChanges = history.filter(e => e.cause !== "created").length;
  historyCount.textContent = `${totalChanges} change${totalChanges !== 1 ? "s" : ""}`;
  detailHistory.replaceChildren();
  
  if (!pastHistory.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = history.length ? "No previous changes yet." : "No history recorded yet.";
    detailHistory.appendChild(empty);
    return;
  }
  
  pastHistory.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "history-item";
    if (entry.removed) {
      item.classList.add("history-removed");
    }
    if (entry.cause === "created") {
      item.classList.add("history-created");
    }

    const metaLine = document.createElement("div");
    metaLine.className = "history-meta";
    
    const reason = entry.removed ? "removed" : entry.cause || "changed";
    const timeSpan = document.createElement("span");
    timeSpan.className = "history-time";
    timeSpan.textContent = formatFullTime(entry.timestamp);
    
    const reasonSpan = document.createElement("span");
    reasonSpan.className = `history-reason reason-${reason}`;
    reasonSpan.textContent = reason;
    
    metaLine.append(timeSpan, reasonSpan);

    // Show the value and diff for this historical change
    const diffContainer = document.createElement("div");
    diffContainer.className = "history-diff";
    
    const prevValue = entry.previousDecodedValue ?? "";
    const newValue = entry.decodedValue ?? "";
    
    if (entry.removed) {
      // Cookie was removed - show what was removed
      if (prevValue) {
        const diff = computeDiff(prevValue, "");
        diffContainer.appendChild(renderDiff(diff));
      } else {
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "diff-empty";
        emptyMsg.textContent = "(cookie removed)";
        diffContainer.appendChild(emptyMsg);
      }
    } else if (entry.cause === "created") {
      // Initial creation - show the initial value (no diff, this is the baseline)
      const pre = document.createElement("pre");
      pre.className = "history-decoded";
      pre.replaceChildren(highlightJson(newValue));
      diffContainer.appendChild(pre);
    } else if (prevValue !== newValue) {
      // Value changed - show the diff
      const diff = computeDiff(prevValue, newValue);
      diffContainer.appendChild(renderDiff(diff));
    } else {
      // No value change (shouldn't happen, but handle it)
      const pre = document.createElement("pre");
      pre.className = "history-decoded";
      pre.replaceChildren(highlightJson(newValue));
      diffContainer.appendChild(pre);
    }

    item.append(metaLine, diffContainer);
    detailHistory.appendChild(item);
  });
};

const getOriginPattern = (url) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return "";
  }
};

const hasHostPermission = async (url) => {
  if (!permissionsApi?.contains) return true;
  const originPattern = getOriginPattern(url);
  if (!originPattern) return false;

  if (originPattern === lastPermissionOrigin && lastPermissionGranted) {
    return true;
  }

  const hasAccess = await permissionsApi.contains({
    origins: [originPattern],
  });
  if (hasAccess) {
    lastPermissionOrigin = originPattern;
    lastPermissionGranted = true;
  }
  return hasAccess;
};

const requestHostPermission = async (url) => {
  if (!permissionsApi?.request || !permissionsApi?.contains) return true;
  const originPattern = getOriginPattern(url);
  if (!originPattern) return false;

  if (originPattern === lastPermissionOrigin && lastPermissionGranted) {
    return true;
  }

  const alreadyGranted = await permissionsApi.contains({
    origins: [originPattern],
  });
  if (alreadyGranted) {
    lastPermissionOrigin = originPattern;
    lastPermissionGranted = true;
    return true;
  }

  if (hostPermissionPromise) {
    return hostPermissionPromise;
  }

  hostPermissionPromise = permissionsApi
    .request({ origins: [originPattern] })
    .then((granted) => {
      lastPermissionOrigin = originPattern;
      lastPermissionGranted = granted;
      return granted;
    })
    .finally(() => {
      hostPermissionPromise = null;
    });

  return hostPermissionPromise;
};

const refresh = async () => {
  const tabUrl = await getInspectedTabUrl();
  const hasPermission = await hasHostPermission(tabUrl);
  if (!hasPermission) {
    renderPermissionNeeded(tabUrl);
    return;
  }

  hidePermissionOverlay();

  const tabId = devtoolsApi.inspectedWindow.tabId;
  
  // Add timeout to prevent hanging on sendMessage
  let response;
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("timeout")), 5000)
    );
    const messagePromise = runtimeApi.sendMessage({
      type: "GET_DECODED_COOKIES",
      payload: { tabId },
    });
    response = await Promise.race([messagePromise, timeoutPromise]);
  } catch (e) {
    console.error("refresh sendMessage error:", e);
    renderEmptyList();
    renderEmptyDetail();
    return;
  }

  if (!response?.ok) {
    renderEmptyList();
    renderEmptyDetail();
    return;
  }

  hidePermissionOverlay();

  cookiesCache = (response.cookies || []).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  renderList(cookiesCache);
};

if (donateButton) {
  donateButton.addEventListener("click", () => {
    window.open(DONATE_URL, "_blank", "noopener,noreferrer");
  });
}

exportJson.addEventListener("click", () => {
  const cookie = cookiesCache.find((item) => item.key === selectedKey);
  exportData(cookie, "json");
});

exportCsv.addEventListener("click", () => {
  const cookie = cookiesCache.find((item) => item.key === selectedKey);
  exportData(cookie, "csv");
});

refreshButton.addEventListener("click", () => {
  getInspectedTabUrl()
    .then((tabUrl) => requestHostPermission(tabUrl))
    .then(() => {
      refresh().catch(() => {
        renderEmptyList();
        renderEmptyDetail();
      });
    })
    .catch(() => {
      renderEmptyList();
      renderEmptyDetail();
    });
});

// Toggle between diff and full value view
if (toggleDiffBtn) {
  toggleDiffBtn.addEventListener("click", () => {
    showDiffMode = !showDiffMode;
    if (selectedCookieRef) {
      renderCurrentValue(selectedCookieRef);
    }
  });
}

// Clear history for selected cookie
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", async () => {
    if (!selectedKey) return;
    
    // Send message to background to clear history for this key
    try {
      await runtimeApi.sendMessage({
        type: "CLEAR_COOKIE_HISTORY",
        payload: { key: selectedKey },
      });
      
      // Update local cache
      const cachedCookie = cookiesCache.find((c) => c.key === selectedKey);
      if (cachedCookie) {
        cachedCookie.history = [];
        renderDetail(cachedCookie);
        renderList(cookiesCache);
      }
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  });
}

if (permissionGrantButton) {
  permissionGrantButton.addEventListener("click", () => {
    getInspectedTabUrl()
      .then((tabUrl) => requestHostPermission(tabUrl))
      .then((granted) => {
        if (granted) {
          refresh().catch(() => {
            renderEmptyList();
            renderEmptyDetail();
          });
          return;
        }
        showPermissionOverlay();
      })
      .catch(() => {
        showPermissionOverlay();
      });
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleRefresh();
  }
});

window.addEventListener("focus", () => {
  scheduleRefresh();
});

// NOTE: Removed storageApi.onChanged listener - it was causing issues in Firefox
// by triggering refresh() every time background script updated storage,
// which would race with COOKIE_HISTORY_UPDATED messages and clear the list.
// The COOKIE_HISTORY_UPDATED message already handles updating the UI.

// Listen for direct cookie history updates from background script
runtimeApi.onMessage.addListener((message) => {
  if (message?.type === "COOKIE_HISTORY_UPDATED") {
    try {
      const { key, entry, history } = message.payload || {};
      if (!key) return false;
      
      // Update the cached cookie's history and values if it exists
      const cachedIndex = cookiesCache.findIndex((c) => c.key === key);
      const cachedCookie = cachedIndex >= 0 ? cookiesCache[cachedIndex] : null;
      
      if (cachedCookie) {
        // Only treat as removed if entry.removed is explicitly true AND cause indicates actual removal
        // Firefox can send spurious messages - be strict about what counts as a removal
        const isActualRemoval = entry?.removed === true && 
          (entry.cause === "explicit" || entry.cause === "evicted" || entry.cause === "expired");
        
        if (isActualRemoval) {
          // Cookie was removed - remove from cache
          cookiesCache.splice(cachedIndex, 1);
          if (key === selectedKey) {
            selectedKey = "";
            selectedCookieRef = null;
            renderEmptyDetail();
          }
          renderList(cookiesCache);
        } else {
          // Update the cached cookie's history and current values
          cachedCookie.history = history;
          if (entry) {
            cachedCookie.rawValue = entry.rawValue;
            cachedCookie.decodedValue = entry.decodedValue;
            cachedCookie.format = entry.format;
            cachedCookie.lastChanged = entry.timestamp;
          }
          // Re-render if this is the selected cookie
          if (key === selectedKey) {
            renderDetail(cachedCookie);
          }
          renderList(cookiesCache);
        }
      } else if (entry && entry.removed !== true) {
        // Cookie not in cache but was added/changed - add it to the cache
        const newCookie = {
          key,
          name: entry.name || "unknown",
          domain: entry.domain || "",
          path: entry.path || "/",
          storeId: entry.storeId,
          secure: entry.secure,
          httpOnly: entry.httpOnly,
          sameSite: entry.sameSite,
          hostOnly: entry.hostOnly,
          session: entry.session,
          expirationDate: entry.expirationDate,
          priority: entry.priority,
          sizeBytes: entry.sizeBytes || 0,
          rawValue: entry.rawValue ?? "",
          decodedValue: entry.decodedValue ?? "",
          format: entry.format || "raw",
          url: entry.url || "",
          history: history || [],
          lastChanged: entry.timestamp,
        };
        cookiesCache.push(newCookie);
        cookiesCache.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        renderList(cookiesCache);
      }
      // If entry.removed and not in cache, nothing to do
    } catch (e) {
      console.error("Error handling COOKIE_HISTORY_UPDATED:", e);
    }
  }
  // Return false/undefined to indicate we're not sending a response
  // This is important for Firefox to not keep the message channel open
  return false;
});

// Don't use cookiesApi.onChanged for refresh - we handle updates via COOKIE_HISTORY_UPDATED
// cookiesApi.onChanged was causing race conditions that cleared the cache

// Use browser-specific tab listeners from browser.js
setupTabListeners(
  () => scheduleRefresh(), // onTabUpdated
  () => scheduleRefresh(), // onTabActivated
);

// Use browser-specific storage listener (Chrome needs it, Firefox doesn't)
setupStorageListener(() => {
  refresh().catch(() => {});
});



