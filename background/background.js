
import { buildWorkerPatchSource } from "./build_worker.js"

let currentTZ = 'Atlantic/Reykjavik';
let currentUA = '';
let knownSWUrls = new Set();
let pendingSWRequests = new Set();

console.log('[TZ-GUARD bg] background.js loaded');

browser.storage.local.get(['tz', 'ua', 'swUrls']).then((result) => {
  if (result.tz) currentTZ = result.tz;
  if (result.ua) currentUA = result.ua;
  if (Array.isArray(result.swUrls)) {
    knownSWUrls = new Set(result.swUrls);
    console.log('[TZ-GUARD bg] Loaded known SW URLs from storage:', Array.from(knownSWUrls));
  }
  console.log('[TZ-GUARD bg] Init complete. TZ:', currentTZ, 'UA:', currentUA ? 'Set' : 'Empty');
}).catch((e) => console.log('[TZ-GUARD bg] Storage load error:', e));

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.tz) currentTZ = changes.tz.newValue || 'Atlantic/Reykjavik';
    if (changes.ua) currentUA = changes.ua.newValue || '';
    console.log('[TZ-GUARD bg] Config updated. TZ:', currentTZ, 'UA:', currentUA ? 'Set' : 'Empty');
  }
});



browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'tz-guard-sw-register' && message.url) {
    if (!knownSWUrls.has(message.url)) {
      knownSWUrls.add(message.url);
      console.log('[TZ-GUARD bg] [Msg] Added new SW URL from bridge:', message.url);
      browser.storage.local.set({ swUrls: Array.from(knownSWUrls) }).catch(() => {});
    } else {
      console.log('[TZ-GUARD bg] [Msg] SW URL already known:', message.url);
    }
  }
});


browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const isServiceWorkerScript = (details.requestHeaders || []).some(
      (h) => h.name.toLowerCase() === 'service-worker' && h.value === 'script'
    );
    if (isServiceWorkerScript) {
      pendingSWRequests.add(details.requestId);
      console.log('[TZ-GUARD bg] [Headers] Matched Service-Worker script request. URL:', details.url, 'ID:', details.requestId);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);


browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const matchedByUrl = knownSWUrls.has(details.url);
    const matchedByHeader = pendingSWRequests.has(details.requestId);
    
    if (!matchedByUrl && !matchedByHeader) return;

    console.log('[TZ-GUARD bg] [BeforeRequest] Matched SW script for patching! URL:', details.url, 'ID:', details.requestId);

    try {
      const filter = browser.webRequest.filterResponseData(details.requestId);
      console.log('[TZ-GUARD bg] [Filter] Created successfully for:', details.url);
      const encoder = new TextEncoder();
      let injected = false;

      filter.ondata = (event) => {
        if (!injected) {
          injected = true;
          filter.write(encoder.encode(buildWorkerPatchSource(currentTZ, currentUA) + '\n'));
          console.log('[TZ-GUARD bg] [Filter] Injected patch into SW script:', details.url);
        }
        filter.write(event.data);
      };

      filter.onstop = () => {
        if (!injected) {
          console.log('[TZ-GUARD bg] [Filter] Stream stopped without data (possibly 304 Not Modified or empty):', details.url);
        }
        filter.disconnect();
      };

      filter.onerror = () => {
        console.error('[TZ-GUARD bg] [Filter] Error for:', details.url, filter.error);
        try { filter.disconnect(); } catch (e) {}
      };
    } catch (e) {
      console.error('[TZ-GUARD bg] [Filter] Failed to create filter for:', details.url, e);
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);