(function() {
  const DEFAULT_TZ = 'Europe/Helsinki';

  document.documentElement.setAttribute('data-tz-guard', DEFAULT_TZ);

  browser.storage.local.get('tz').then(({ tz }) => {
    if (tz) {
      document.documentElement.setAttribute('data-tz-guard', tz);
      document.documentElement.dispatchEvent(new CustomEvent('tz-guard-update', { detail: tz }));
    }
  }).catch(() => {});
})();