(function() {
  
  browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders']).then(({ tz, ua, enabled, spoofHeaders }) => {
    const t = tz || '';
    const u = ua || '';
    const e = enabled !== false; // default true
    const s = spoofHeaders !== false; // default true

    try {
        var cfgStr = JSON.stringify({ tz: t, ua: u, enabled: e, spoofHeaders: s });
        window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
        window.localStorage.setItem('__tzGuardConfig', cfgStr);
    } catch(err) {}

    if (t) {
        document.documentElement.setAttribute('data-tz-guard-tz', t);
    }

    document.documentElement.setAttribute('data-tz-guard-ua', u);
    document.documentElement.setAttribute('data-tz-guard-enabled', String(e));
    document.documentElement.setAttribute('data-tz-guard-spoof-headers', String(s));

    document.documentElement.dispatchEvent(new CustomEvent('tz-guard-update-config', {
      detail: JSON.stringify({ tz: t, ua: u, enabled: e, spoofHeaders: s })
    }));
  }).catch(() => {});

  
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'config-update') {
      const t = message.tz || '';
      const u = message.ua || '';
      const e = message.enabled !== false;
      const s = message.spoofHeaders !== false;

      try {
          var cfgStr = JSON.stringify({ tz: t, ua: u, enabled: e, spoofHeaders: s });
          window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
          window.localStorage.setItem('__tzGuardConfig', cfgStr);
      } catch(err) {}

      if (t) {
        document.documentElement.setAttribute('data-tz-guard-tz', t);
      } else {
        document.documentElement.removeAttribute('data-tz-guard-tz');
      }
      document.documentElement.setAttribute('data-tz-guard-ua', u);
      document.documentElement.setAttribute('data-tz-guard-enabled', String(e));
      document.documentElement.setAttribute('data-tz-guard-spoof-headers', String(s));

      document.documentElement.dispatchEvent(new CustomEvent('tz-guard-update-config', {
        detail: JSON.stringify({ tz: t, ua: u, enabled: e, spoofHeaders: s })
      }));
    }
  });

  
  document.documentElement.addEventListener('tz-guard-sw-register', (e) => {
    try {
      browser.runtime.sendMessage({ type: 'tz-guard-sw-register', url: e.detail });
    } catch (err) {}
  });
})();