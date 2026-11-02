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
// Site whitelist
// ============================================================
// Empty whitelist = spoof everywhere (default behaviour).
// Entries are bare domains ("example.com", without scheme/path/port);
// the domain itself and all of its subdomains match.
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function isSiteAllowed(url, whitelist) {
  if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
  const host = hostnameOf(url);
  if (!host) return false;
  return whitelist.some((entry) => {
    const e = String(entry).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
    if (!e) return false;
    return host === e || host.endsWith('.' + e);
  });
}

// Best guess of the page that initiated the request (falls back to the request URL itself)
function requestPageUrl(details) {
  return details.originUrl || details.documentUrl || details.url;
}

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
      const result = await browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']);
      const enabled = result.enabled !== false;
      const spoofHeaders = result.spoofHeaders !== false;
      const whitelist = Array.isArray(result.whitelist) ? result.whitelist : [];

      if (!enabled || !spoofHeaders) return;
      if (!isSiteAllowed(requestPageUrl(details), whitelist)) return;

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
      const result = await browser.storage.local.get(['tz', 'ua', 'enabled', 'whitelist']);
      const enabled = result.enabled !== false;
      const whitelist = Array.isArray(result.whitelist) ? result.whitelist : [];

      if (!enabled) return;

      // The SW script itself or the page that registered it must be whitelisted
      const swAllowed = isSiteAllowed(details.url, whitelist) ||
        isSiteAllowed(details.originUrl || '', whitelist) ||
        isSiteAllowed(details.documentUrl || '', whitelist);
      if (!swAllowed) return;

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