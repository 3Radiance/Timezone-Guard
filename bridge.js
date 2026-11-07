(function() {

  // ============================================================
  // Host chain resolution (per-frame decision)
  // ============================================================
  // Own hostname + all ancestor hostnames. For cross-origin ancestors
  // location.hostname is NOT readable, but location.href IS (spec
  // allows reading href across origins) — parse the hostname out of
  // it. This lets frames spawned by an exception site inherit its
  // status (e.g. the Cloudflare Turnstile iframe inside an excepted
  // page stays native automatically).
  function hostnameFromUrl(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function readWinHost(win) {
    try {
      var h = win.location.hostname;
      if (h) return String(h).toLowerCase();
    } catch (e) {}
    try {
      var href = win.location.href;
      if (href) return hostnameFromUrl(href);
    } catch (e2) {}
    return '';
  }

  function resolveHostChain() {
    var hosts = [];
    var w = window;
    try {
      for (var d = 0; d < 16; d++) {
        var h = readWinHost(w);
        if (h) hosts.push(h);
        if (w === w.top) break;
        var p = w.parent;
        if (!p || p === w) break;
        w = p;
      }
    } catch (e) {}
    return hosts;
  }

  // ============================================================
  // Site exception list (per-frame decision)
  // ============================================================
  // Must stay in sync with background.js isSiteAllowed:
  // spoofing is ON everywhere by default; the list is an EXCEPTION
  // list of sites (plus subdomains) where the environment stays
  // fully native — and that status is inherited by frames they
  // spawn and requests they initiate. Empty list = no exceptions.
  function isSiteAllowed(hosts, whitelist) {
    if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
    var list = Array.isArray(hosts) ? hosts : [hosts];
    for (var i = 0; i < list.length; i++) {
      var host = String(list[i] || '').toLowerCase();
      if (!host) continue;
      for (var j = 0; j < whitelist.length; j++) {
        var e = String(whitelist[j]).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
        if (!e) continue;
        if (host === e || host.endsWith('.' + e)) return false;
      }
    }
    return true;
  }

  function applyContent(cfg) {
    const t = cfg.tz || '';
    const u = cfg.ua || '';
    const e = cfg.enabled !== false;
    // Spoofing is disabled on exception (listed) sites for this frame
    const allowed = cfg.siteAllowed !== false;
    const effectiveEnabled = e && allowed;
    const root = document.documentElement;

    if (!effectiveEnabled) {
      // ALWAYS signal the current state (master toggle off or exception
      // site). The cached page-storage cfg could otherwise be a stale
      // "enabled" record from a previous visit and resurrect the spoof
      // on reload — so overwrite it with a neutral disabled marker.
      try {
        root.setAttribute('data-tz-guard-enabled', 'false');
      } catch (err) {}
      try {
        var offStr = JSON.stringify({
          tz: '', ua: '', enabled: false, spoofHeaders: true,
          whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : []
        });
        window.sessionStorage.setItem('__tzGuardConfig', offStr);
        window.localStorage.setItem('__tzGuardConfig', offStr);
      } catch (err2) {}

      root.dispatchEvent(new CustomEvent('tz-guard-update-config', {
        detail: JSON.stringify({
          tz: '', ua: '', enabled: false, spoofHeaders: true,
          whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : []
        })
      }));
      return;
    }

    try {
        var cfgStr = JSON.stringify({
          tz: t, ua: u, enabled: e,
          spoofHeaders: cfg.spoofHeaders !== false,
          whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : []
        });
        window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
        window.localStorage.setItem('__tzGuardConfig', cfgStr);
    } catch(err) {}

    if (t) {
        root.setAttribute('data-tz-guard-tz', t);
    } else {
        root.removeAttribute('data-tz-guard-tz');
    }

    root.setAttribute('data-tz-guard-ua', u);
    root.setAttribute('data-tz-guard-enabled', 'true');
    root.setAttribute('data-tz-guard-spoof-headers', String(cfg.spoofHeaders !== false));

    root.dispatchEvent(new CustomEvent('tz-guard-update-config', {
      detail: JSON.stringify({
        tz: t, ua: u, enabled: true,
        spoofHeaders: cfg.spoofHeaders !== false,
        whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : []
      })
    }));
  }

  let currentWhitelist = null;

  function withWhitelist(whitelist) {
    currentWhitelist = Array.isArray(whitelist) ? whitelist : [];
    return currentWhitelist;
  }

  browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']).then(({ tz, ua, enabled, spoofHeaders, whitelist }) => {
    withWhitelist(whitelist);
    applyContent({
      tz, ua, enabled, spoofHeaders,
      whitelist: currentWhitelist,
      siteAllowed: isSiteAllowed(resolveHostChain(), whitelist)
    });
  }).catch(() => {});

  
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'config-update') {
      withWhitelist(message.whitelist);
      applyContent({
        tz: message.tz,
        ua: message.ua,
        enabled: message.enabled,
        spoofHeaders: message.spoofHeaders,
        whitelist: currentWhitelist,
        siteAllowed: isSiteAllowed(resolveHostChain(), message.whitelist)
      });
    }
  });

  
  document.documentElement.addEventListener('tz-guard-sw-register', (e) => {
    if (!isSiteAllowed(resolveHostChain(), currentWhitelist)) {
      return; // never track SW URLs of exception (listed) sites
    }
    try {
      browser.runtime.sendMessage({ type: 'tz-guard-sw-register', url: e.detail });
    } catch (err) {}
  });
})();
