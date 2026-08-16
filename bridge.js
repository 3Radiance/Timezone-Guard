(function() {
  const DEFAULT_TZ = 'Europe/Helsinki';
  const DEFAULT_UA = '';

  document.documentElement.setAttribute('data-tz-guard-tz', DEFAULT_TZ);
  document.documentElement.setAttribute('data-tz-guard-ua', DEFAULT_UA);

  browser.storage.local.get(['tz', 'ua']).then(({ tz, ua }) => {
    const t = tz || DEFAULT_TZ;
    const u = ua || '';

    document.documentElement.setAttribute('data-tz-guard-tz', t);
    document.documentElement.setAttribute('data-tz-guard-ua', u);

    document.documentElement.dispatchEvent(new CustomEvent('tz-guard-update-config', {
      detail: JSON.stringify({ tz: t, ua: u })
    }));
  }).catch(() => {});

  document.documentElement.addEventListener('tz-guard-sw-register', (e) => {
    try {
      browser.runtime.sendMessage({ type: 'tz-guard-sw-register', url: e.detail });
    } catch (err) {}
  });
})();