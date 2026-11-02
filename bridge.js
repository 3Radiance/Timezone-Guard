(function() {

  // Frame hostname resolution: about:blank / srcdoc frames have an empty
  // location.hostname but INHERIT the embedding origin — fall back to the
  // parent/top frame (same-origin access only; SecurityError otherwise).
  function resolveFrameHostname() {
    try {
      var h = window.location && window.location.hostname;
      if (h) return String(h).toLowerCase();
    } catch (e) {}
    try {
      if (window.parent && window.parent !== window &&
          window.parent.location && window.parent.location.hostname) {
        return String(window.parent.location.hostname).toLowerCase();
      }
      if (window.top && window.top.location && window.top.location.hostname) {
        return String(window.top.location.hostname).toLowerCase();
      }
    } catch (e) {}
    return '';
  }

  // ============================================================
  // Site whitelist (per-frame decision)
  // ============================================================
  // Must stay in sync with background.js isSiteAllowed:
  // empty whitelist = allowed everywhere; bare domains match
  // themselves and all subdomains.
  function isSiteAllowed(hostname, whitelist) {
    if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return whitelist.some((entry) => {
      const e = String(entry).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
      if (!e) return false;
      return host === e || host.endsWith('.' + e);
    });
  }

  function applyContent(cfg) {
    const t = cfg.tz || '';
    const u = cfg.ua || '';
    const e = cfg.enabled !== false;
    // Extension only acts on whitelisted sites for this frame
    const allowed = cfg.siteAllowed !== false;
    const effectiveEnabled = e && allowed;

    try {
        var cfgStr = JSON.stringify({
          tz: t, ua: u, enabled: e,
          spoofHeaders: cfg.spoofHeaders !== false,
          whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : []
        });
        window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
        window.localStorage.setItem('__tzGuardConfig', cfgStr);
    } catch(err) {}

    if (t && effectiveEnabled) {
        document.documentElement.setAttribute('data-tz-guard-tz', t);
    } else {
        document.documentElement.removeAttribute('data-tz-guard-tz');
    }

    document.documentElement.setAttribute('data-tz-guard-ua', effectiveEnabled ? u : '');
    document.documentElement.setAttribute('data-tz-guard-enabled', String(effectiveEnabled));
    document.documentElement.setAttribute('data-tz-guard-spoof-headers', String(cfg.spoofHeaders !== false));

    document.documentElement.dispatchEvent(new CustomEvent('tz-guard-update-config', {
      detail: JSON.stringify({ tz: t, ua: u, enabled: effectiveEnabled, spoofHeaders: cfg.spoofHeaders !== false })
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
      siteAllowed: isSiteAllowed(resolveFrameHostname(), whitelist)
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
        siteAllowed: isSiteAllowed(resolveFrameHostname(), message.whitelist)
      });
    }
  });

  
  document.documentElement.addEventListener('tz-guard-sw-register', (e) => {
    if (currentWhitelist && currentWhitelist.length > 0 &&
        !isSiteAllowed(resolveFrameHostname(), currentWhitelist)) {
      return; // never track SW URLs of non-whitelisted sites
    }
    try {
      browser.runtime.sendMessage({ type: 'tz-guard-sw-register', url: e.detail });
    } catch (err) {}
  });
})();
