const devtoolsApi = globalThis.browser?.devtools || chrome.devtools;

devtoolsApi.panels.create(
  "LookieCookie",
  "icons/cookie.svg",
  "panel.html",
  () => {},
);
