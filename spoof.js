(function() {
  'use strict';

  let TARGET_TIMEZONE = document.documentElement.getAttribute('data-tz-guard') || 'Europe/Helsinki';


  document.documentElement.addEventListener('tz-guard-update', (e) => {
    TARGET_TIMEZONE = e.detail;
  });

  function spoofWindow(win) {
    try {
      if (!win || win.__tz_spoofed) return;
      win.__tz_spoofed = true;

      const OriginalDTF = win.Intl.DateTimeFormat;

      const DTFProxy = new Proxy(OriginalDTF, {
        construct(target, args, newTarget) {
          let [locales, options] = args;
          options = Object.assign({}, options);
          if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
          return Reflect.construct(target, [locales, options], newTarget);
        },
        apply(target, thisArg, args) {
          let [locales, options] = args;
          options = Object.assign({}, options);
          if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
          return Reflect.construct(target, [locales, options]);
        }
      });
      win.Intl.DateTimeFormat = DTFProxy;

      const origGetTimezoneOffset = win.Date.prototype.getTimezoneOffset;
      win.Date.prototype.getTimezoneOffset = function() {
        try {
          const dtf = new OriginalDTF('en-US', {
            timeZone: TARGET_TIMEZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
          });
          const parts = dtf.formatToParts(this);
          const map = {};
          parts.forEach(p => map[p.type] = p.value);
          const targetDate = new Date(Date.UTC(map.year, map.month - 1, map.day, map.hour % 24, map.minute, map.second));
          const utcDate = new Date(Date.UTC(this.getUTCFullYear(), this.getUTCMonth(), this.getUTCDate(), this.getUTCHours(), this.getUTCMinutes(), this.getUTCSeconds()));
          return Math.round((utcDate - targetDate) / 60000);
        } catch (e) {
          return origGetTimezoneOffset.call(this);
        }
      };

      const dateMethodsToPatch = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
      dateMethodsToPatch.forEach(methodName => {
        const original = win.Date.prototype[methodName];
        win.Date.prototype[methodName] = function(...args) {
          try {
            if (methodName.startsWith('toLocale')) {
              let [locales, options] = args;
              options = Object.assign({}, options);
              if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
              return original.call(this, locales, options);
            }
            const dtf = new OriginalDTF('en-US', {
              timeZone: TARGET_TIMEZONE,
              weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              hour12: false, timeZoneName: 'short'
            });
            const parts = dtf.formatToParts(this);
            const map = {};
            parts.forEach(p => map[p.type] = p.value);
            const offsetMin = this.getTimezoneOffset();
            const offsetHours = Math.floor(Math.abs(offsetMin) / 60);
            const offsetMins = Math.abs(offsetMin) % 60;
            const offsetSign = offsetMin <= 0 ? '+' : '-';
            const offsetStr = 'GMT' + offsetSign + String(offsetHours).padStart(2,'0') + String(offsetMins).padStart(2,'0');
            const dateStr = map.weekday + ' ' + map.month + ' ' + map.day + ' ' + map.year;
            const timeStr = map.hour + ':' + map.minute + ':' + map.second;
            if (methodName === 'toDateString') return dateStr;
            if (methodName === 'toTimeString') return timeStr + ' ' + offsetStr + ' (' + TARGET_TIMEZONE + ')';
            return dateStr + ' ' + timeStr + ' ' + offsetStr + ' (' + TARGET_TIMEZONE + ')';
          } catch (e) {
            return original.call(this, ...args);
          }
        };
      });
    } catch (e) {}
  }

  spoofWindow(window);

  const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      for (let node of mutation.addedNodes) {
        if (node.tagName === 'IFRAME') {
          try {
            spoofWindow(node.contentWindow);
            node.addEventListener('load', () => spoofWindow(node.contentWindow));
          } catch (e) {}
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();