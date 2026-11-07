import { buildWorkerPatchSource } from "./build_worker.js"

let knownSWUrls = new Set();
let pendingSWRequests = new Set();

const langMap = {
  'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
  'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
  'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
};

function buildAcceptLanguage(tz) {
  // Single language — must exactly mirror navigator.*(language|languages)
  // of the spoofed locale (creepjs flags header/JS mismatches).
  return langMap[tz] || 'en-US';
}

// ============================================================
// Site exception list
// ============================================================
// Spoofing is ON everywhere by default. The list is an EXCEPTION
// list: entries are bare domains ("example.com", without
// scheme/path/port) whose sites — themselves and all subdomains —
// stay completely native. Empty list = no exceptions.
//
// Inheritance: the exception status of a site extends to EVERYTHING
// it spawns — frames it embeds (like the Cloudflare Turnstile
// iframe) and network requests it (or its frames) initiate. For that
// we keep a per-tab frame registry and reconstruct each request's
// ancestor chain; an exception site anywhere in the chain disables
// the extension for the request.
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

// Frame registry: "tabId:frameId" → { url: document URL of that frame,
// parentFrameId }. Rebuilt on every main-frame navigation.
const frameTree = new Map();
// Top-level document URL per tab (fallback for requests without frame info)
const topDocs = new Map();

function noteRequestContext(details) {
  if (details.tabId === undefined || details.tabId === null || details.tabId === -1) return;
  const tabKey = String(details.tabId);
  if (details.type === 'main_frame') {
    topDocs.set(details.tabId, details.url);
    for (const key of frameTree.keys()) {
      if (key.startsWith(tabKey + ':')) frameTree.delete(key);
    }
    frameTree.set(tabKey + ':0', { url: details.url, parentFrameId: -1 });
  } else if (details.type === 'sub_frame' && details.frameId > 0) {
    frameTree.set(tabKey + ':' + details.frameId, {
      url: details.url,
      parentFrameId: details.parentFrameId
    });
  }
}

// All hostnames involved in a request: request URL, containing document,
// initiator, the tab's top document, and every ancestor frame in between
// (walked through the registry via parentFrameId).
function involvedHosts(details) {
  const hosts = [];
  const push = (u) => {
    const h = hostnameOf(u);
    if (h) hosts.push(h);
  };
  push(details.url);
  push(details.documentUrl);
  push(details.originUrl);
  if (details.tabId !== undefined && details.tabId !== -1) {
    push(topDocs.get(details.tabId));
    let frameId = details.parentFrameId;
    const tabKey = String(details.tabId);
    let depth = 0;
    while (Number.isInteger(frameId) && frameId >= 0 && depth < 16) {
      const entry = frameTree.get(tabKey + ':' + frameId);
      if (!entry) break;
      push(entry.url);
      frameId = entry.parentFrameId;
      depth++;
    }
  }
  return hosts;
}

function matchesExceptionEntry(host, whitelist) {
  for (const entry of whitelist) {
    const e = String(entry).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
    if (!e) continue;
    if (host === e || host.endsWith('.' + e)) return true;
  }
  return false;
}

// True = extension may act on this request; false = it touches an
// exception site anywhere in its origin chain (inheritance rule).
function isSiteAllowed(details, whitelist) {
  if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
  const hosts = involvedHosts(details);
  for (const host of hosts) {
    if (matchesExceptionEntry(host, whitelist)) return false;
  }
  return true;
}
// Registry cleanup: frames and top documents of closed tabs
browser.tabs.onRemoved.addListener((tabId) => {
  topDocs.delete(tabId);
  const tabKey = String(tabId) + ':';
  for (const key of frameTree.keys()) {
    if (key.startsWith(tabKey)) frameTree.delete(key);
  }
});

console.log('[TZ-GUARD bg] background.js loaded');

// Load SW URLs once at startup
browser.storage.local.get(['swUrls']).then((result) => {
  if (Array.isArray(result.swUrls)) {
    knownSWUrls = new Set(result.swUrls);
    console.log('[TZ-GUARD bg] Loaded known SW URLs from storage:', Array.from(knownSWUrls));
  }
}).catch((e) => console.log('[TZ-GUARD bg] Storage load error:', e));

// Message handler: SW registration + config requests
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'tz-guard-sw-register' && message.url) {
    if (!knownSWUrls.has(message.url)) {
      knownSWUrls.add(message.url);
      console.log('[TZ-GUARD bg] [Msg] Added new SW URL from bridge:', message.url);
      browser.storage.local.set({ swUrls: Array.from(knownSWUrls) }).catch(() => {});
    } else {
      console.log('[TZ-GUARD bg] [Msg] SW URL already known:', message.url);
    }
    return;
  }

  if (message && message.type === 'get-config') {
    browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']).then((result) => {
      sendResponse({
        tz: result.tz || '',
        ua: result.ua || '',
        enabled: result.enabled !== false,
        spoofHeaders: result.spoofHeaders !== false,
        whitelist: Array.isArray(result.whitelist) ? result.whitelist : []
      });
    }).catch(() => {
      sendResponse({ tz: '', ua: '', enabled: true, spoofHeaders: true, whitelist: [] });
    });
    return true; 
  }
});


// Broadcast config to all tabs when settings change
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']).then((result) => {
    var cfg = {
      type: 'config-update',
      tz: result.tz || '',
      ua: result.ua || '',
      enabled: result.enabled !== false,
      spoofHeaders: result.spoofHeaders !== false,
      whitelist: Array.isArray(result.whitelist) ? result.whitelist : []
    };
    browser.tabs.query({}).then((tabs) => {
      for (var i = 0; i < tabs.length; i++) {
        try {
          browser.tabs.sendMessage(tabs[i].id, cfg).catch(() => {});
        } catch (e) {}
      }
    }).catch(() => {});
  }).catch(() => {});
});


// Combined listener: Accept-Language + User-Agent header spoofing.
// Reads storage INSIDE the handler — never relies on cached globals.
browser.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    try {
      noteRequestContext(details);
      const result = await browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']);
      const enabled = result.enabled !== false;
      const spoofHeaders = result.spoofHeaders !== false;
      const whitelist = Array.isArray(result.whitelist) ? result.whitelist : [];

      if (!enabled || !spoofHeaders) return;
      // Skip for exception sites AND anything they spawned/imiated
      if (!isSiteAllowed(details, whitelist)) return;

      const currentTZ = result.tz || 'Atlantic/Reykjavik';
      const currentUA = result.ua || '';
      const headers = details.requestHeaders || [];
      const acceptLanguageValue = buildAcceptLanguage(currentTZ);
      let foundAL = false;
      let foundUA = false;

      for (const h of headers) {
        const nameLower = h.name.toLowerCase();
        if (nameLower === 'accept-language') {
          h.value = acceptLanguageValue;
          foundAL = true;
        }
        if (nameLower === 'user-agent' && currentUA) {
          h.value = currentUA;
          foundUA = true;
        }
      }
      if (!foundAL) {
        headers.push({ name: 'Accept-Language', value: acceptLanguageValue });
      }
      if (!foundUA && currentUA) {
        headers.push({ name: 'User-Agent', value: currentUA });
      }

      return { requestHeaders: headers };
    } catch (e) {
      console.error('[TZ-GUARD bg] onBeforeSendHeaders error:', e);
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestHeaders']
);


// Detect Service Worker script requests
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    noteRequestContext(details);
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


// Inject patch into Service Worker scripts — reads storage inside handler.
browser.webRequest.onBeforeRequest.addListener(
  async (details) => {
    try {
      noteRequestContext(details);
      const result = await browser.storage.local.get(['tz', 'ua', 'enabled', 'whitelist']);
      const enabled = result.enabled !== false;
      const whitelist = Array.isArray(result.whitelist) ? result.whitelist : [];

      if (!enabled) return;

      // Skip if the SW script, its registering page, or any ancestor
      // in the frame chain belongs to an exception site (inheritance)
      if (!isSiteAllowed(details, whitelist)) return;

      const matchedByUrl = knownSWUrls.has(details.url);
      const matchedByHeader = pendingSWRequests.has(details.requestId);

      if (!matchedByUrl && !matchedByHeader) return;

      console.log('[TZ-GUARD bg] [BeforeRequest] Matched SW script for patching! URL:', details.url, 'ID:', details.requestId);

      const filter = browser.webRequest.filterResponseData(details.requestId);
      console.log('[TZ-GUARD bg] [Filter] Created successfully for:', details.url);
      const encoder = new TextEncoder();
      let injected = false;
      const currentTZ = result.tz || 'Atlantic/Reykjavik';
      const currentUA = result.ua || '';

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