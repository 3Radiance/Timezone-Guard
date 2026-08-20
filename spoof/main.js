(function() {
  'use strict';

  var TARGET_TIMEZONE = '';
  var TARGET_UA = '';
  var EXTENSION_ENABLED = true;
  var SPOOF_HEADERS = true;
  var hasAppliedPatches = false;

  var spoofedWindows = new WeakSet();
  var spoofedSWs = new WeakSet();
  var spoofedWorkers = new WeakSet();
  var patchedIframeProtos = new WeakSet();
  var iframeObserver = null;

  var langMap = {
    'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
    'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
    'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
  };

  function getAppVersion(ua) {
    if (!ua) return '';
    if (ua.indexOf('Firefox/') !== -1 || (ua.indexOf('Gecko/') !== -1 && ua.indexOf('Firefox') !== -1)) {
      var platform = 'Windows';
      if (ua.indexOf('X11') !== -1) platform = 'X11';
      else if (ua.indexOf('Macintosh') !== -1) platform = 'Macintosh';
      else if (ua.indexOf('Android') !== -1) platform = 'Android';
      return '5.0 (' + platform + ')';
    }
    var afterMozilla = ua.indexOf('Mozilla/') === 0 ? ua.substring(8) : ua;
    var idx = afterMozilla.indexOf(' AppleWebKit/');
    if (idx !== -1) return afterMozilla.substring(0, idx);
    idx = afterMozilla.indexOf(' Safari/');
    if (idx !== -1) return afterMozilla.substring(0, idx);
    return afterMozilla;
  }

  function makeNative(fn, name, length) {
    length = length || 0;
    var fnName = name || fn.name || '';
    var str = 'function ' + fnName + '() {\n    [native code]\n}';
    var proxy = new Proxy(fn, {
      construct: function(target, args) {
        throw new TypeError(fnName + ' is not a constructor');
      }
    });
    Object.defineProperty(proxy, 'toString', {
      value: function toString() { return str; },
      writable: true,
      configurable: true
    });
    try {
      Object.defineProperty(proxy, 'name', { value: fnName, configurable: true });
      Object.defineProperty(proxy, 'length', { value: length, configurable: true });
    } catch (e) {}
    return proxy;
  }

  // ============================================================
  // Worker patch (self-contained, serialized into workers)
  // ============================================================
  function __tzGuardWorkerPatch(TARGET_TIMEZONE, TARGET_UA) {
    'use strict';
    try {
      var langMap = {
        'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
        'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
        'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
      };
      var SPOOFED_LANG = langMap[TARGET_TIMEZONE] || 'en-US';
      var SPOOFED_LANGS = Object.freeze([SPOOFED_LANG, 'en-US']);

      function getAppVersion(ua) {
        if (!ua) return '';
        if (ua.indexOf('Firefox/') !== -1 || (ua.indexOf('Gecko/') !== -1 && ua.indexOf('Firefox') !== -1)) {
          var platform = 'Windows';
          if (ua.indexOf('X11') !== -1) platform = 'X11';
          else if (ua.indexOf('Macintosh') !== -1) platform = 'Macintosh';
          else if (ua.indexOf('Android') !== -1) platform = 'Android';
          return '5.0 (' + platform + ')';
        }
        var afterMozilla = ua.indexOf('Mozilla/') === 0 ? ua.substring(8) : ua;
        var idx = afterMozilla.indexOf(' AppleWebKit/');
        if (idx !== -1) return afterMozilla.substring(0, idx);
        idx = afterMozilla.indexOf(' Safari/');
        if (idx !== -1) return afterMozilla.substring(0, idx);
        return afterMozilla;
      }

      function makeNative(fn, name, length) {
        length = length || 0;
        var fnName = name || fn.name || '';
        var str = 'function ' + fnName + '() {\n    [native code]\n}';
        var proxy = new Proxy(fn, {
          construct: function(target, args) {
            throw new TypeError(fnName + ' is not a constructor');
          }
        });
        Object.defineProperty(proxy, 'toString', { value: function() { return str; }, writable: true, configurable: true });
        try {
          Object.defineProperty(proxy, 'name', { value: fnName, configurable: true });
          Object.defineProperty(proxy, 'length', { value: length, configurable: true });
        } catch (e) {}
        return proxy;
      }

      var OriginalDate = self.Date;
      var OriginalDTF = self.Intl.DateTimeFormat;
      var OriginalNF = self.Intl.NumberFormat;

      var offsetFormatter = new OriginalDTF('en-US', {
        timeZone: TARGET_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      var stringFormatter = new OriginalDTF('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZoneName: 'long', timeZone: TARGET_TIMEZONE
      });

      function targetOffsetMsAt(epochMs) {
        try {
          var parts = offsetFormatter.formatToParts(new OriginalDate(epochMs));
          var map = {};
          for (var i = 0; i < parts.length; i++) {
            map[parts[i].type] = parts[i].value;
          }
          var y = parseInt(map.year, 10);
          var mo = parseInt(map.month, 10) - 1;
          var d = parseInt(map.day, 10);
          var h = parseInt(map.hour, 10);
          if (h === 24) h = 0;
          var mi = parseInt(map.minute, 10);
          var s = parseInt(map.second, 10);
          var asUTC = OriginalDate.UTC(y, mo, d, h, mi, s, 0);
          return -(asUTC - epochMs);
        } catch (e) {
          return 0;
        }
      }

      function targetOffsetMinutesAt(epochMs) {
        return Math.round(targetOffsetMsAt(epochMs) / 60000);
      }

      function shiftedUTC(epochMs) {
        var offMs = targetOffsetMsAt(epochMs);
        return new OriginalDate(epochMs - offMs);
      }

      function localComponentsToEpoch(y, mo, d, h, mi, s, ms) {
        var raw = OriginalDate.UTC(y, mo, d, h, mi, s, ms);
        var offMs = targetOffsetMsAt(raw);
        var epoch = raw + offMs;
        var offMs2 = targetOffsetMsAt(epoch);
        if (offMs2 !== offMs) epoch = raw + offMs2;
        return epoch;
      }

      var origValueOf = OriginalDate.prototype.valueOf;
      var origSetTime = OriginalDate.prototype.setTime;
      var origGetTZOffset = OriginalDate.prototype.getTimezoneOffset;

      function currentTargetParts(dateInstance) {
        var s = shiftedUTC(origValueOf.call(dateInstance));
        return { y: s.getUTCFullYear(), mo: s.getUTCMonth(), d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes(), sec: s.getUTCSeconds(), ms: s.getUTCMilliseconds() };
      }

      function SpoofedDTF(locales, options) {
        if (!(this instanceof SpoofedDTF)) return new SpoofedDTF(locales, options);
        options = Object.assign({}, options || {});
        if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
        if (!locales) locales = SPOOFED_LANG;
        return new OriginalDTF(locales, options);
      }
      SpoofedDTF.prototype = OriginalDTF.prototype;
      try { OriginalDTF.prototype.constructor = SpoofedDTF; } catch(e) {}
      SpoofedDTF.supportedLocalesOf = OriginalDTF.supportedLocalesOf;
      makeNative(SpoofedDTF, 'DateTimeFormat', 0);
      self.Intl.DateTimeFormat = SpoofedDTF;

      function SpoofedNF(locales, options) {
        if (!(this instanceof SpoofedNF)) return new SpoofedNF(locales, options);
        if (!locales) locales = SPOOFED_LANG;
        return new OriginalNF(locales, options);
      }
      SpoofedNF.prototype = OriginalNF.prototype;
      try { OriginalNF.prototype.constructor = SpoofedNF; } catch(e) {}
      SpoofedNF.supportedLocalesOf = OriginalNF.supportedLocalesOf;
      makeNative(SpoofedNF, 'NumberFormat', 0);
      self.Intl.NumberFormat = SpoofedNF;

      var origNumberToLocaleString = self.Number.prototype.toLocaleString;
      self.Number.prototype.toLocaleString = makeNative(function(locales, options) {
        if (!locales) locales = SPOOFED_LANG;
        return origNumberToLocaleString.call(this, locales, options);
      }, 'toLocaleString', 0);

      self.Date.prototype.getTimezoneOffset = makeNative(function getTimezoneOffset() {
        try {
          return targetOffsetMinutesAt(origValueOf.call(this));
        } catch(e) { return NaN; }
      }, 'getTimezoneOffset', 0);

      var fields = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
      for (var fi = 0; fi < fields.length; fi++) {
        (function(field) {
          var getterName = 'get' + field;
          var utcGetterName = 'getUTC' + field;
          self.Date.prototype[getterName] = makeNative(function() {
            try {
              return shiftedUTC(origValueOf.call(this))[utcGetterName]();
            } catch(e) { return NaN; }
          }, getterName, 0);
        })(fields[fi]);
      }
      self.Date.prototype.getYear = makeNative(function() {
        try {
          return shiftedUTC(origValueOf.call(this)).getUTCFullYear() - 1900;
        } catch(e) { return NaN; }
      }, 'getYear', 0);

      function makeSetter(name, argCount, apply) {
        self.Date.prototype[name] = makeNative(function() {
          var p = currentTargetParts(this);
          apply(p, arguments);
          var newEpoch = localComponentsToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.sec, p.ms);
          origSetTime.call(this, newEpoch);
          return origValueOf.call(this);
        }, name, argCount);
      }
      makeSetter('setFullYear', 3, function(p, a) { p.y = a[0]; if (a.length > 1) p.mo = a[1]; if (a.length > 2) p.d = a[2]; });
      makeSetter('setMonth', 2, function(p, a) { p.mo = a[0]; if (a.length > 1) p.d = a[1]; });
      makeSetter('setDate', 1, function(p, a) { p.d = a[0]; });
      makeSetter('setHours', 4, function(p, a) { p.h = a[0]; if (a.length > 1) p.mi = a[1]; if (a.length > 2) p.sec = a[2]; if (a.length > 3) p.ms = a[3]; });
      makeSetter('setMinutes', 3, function(p, a) { p.mi = a[0]; if (a.length > 1) p.sec = a[1]; if (a.length > 2) p.ms = a[2]; });
      makeSetter('setSeconds', 2, function(p, a) { p.sec = a[0]; if (a.length > 1) p.ms = a[1]; });
      makeSetter('setMilliseconds', 1, function(p, a) { p.ms = a[0]; });
      self.Date.prototype.setYear = makeNative(function(y) {
        var p = currentTargetParts(this);
        p.y = y < 100 ? 1900 + y : y;
        var newEpoch = localComponentsToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.sec, p.ms);
        origSetTime.call(this, newEpoch);
        return origValueOf.call(this);
      }, 'setYear', 1);

      var methods = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
      for (var mi2 = 0; mi2 < methods.length; mi2++) {
        (function(methodName) {
          var original = self.Date.prototype[methodName];
          var patchedMethod = function() {
            var args = Array.prototype.slice.call(arguments);
            try {
              if (methodName.indexOf('toLocale') === 0) {
                var locales = args[0] || SPOOFED_LANG;
                var options = Object.assign({}, args[1]);
                if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
                return original.call(this, locales, options);
              }
              var parts = stringFormatter.formatToParts(this);
              var map = {};
              parts.forEach(function(p) { map[p.type] = p.value; });
              var offsetMin = self.Date.prototype.getTimezoneOffset.call(this);
              var absMin = Math.abs(offsetMin);
              var offsetHours = ('0' + Math.floor(absMin / 60)).slice(-2);
              var offsetMins = ('0' + (absMin % 60)).slice(-2);
              var offsetSign = offsetMin <= 0 ? '+' : '-';
              var offsetStr = 'GMT' + offsetSign + offsetHours + offsetMins;
              var dateStr = map.weekday + ' ' + map.month + ' ' + map.day + ' ' + map.year;
              var timeStr = map.hour + ':' + map.minute + ':' + map.second;
              var tzName = map.timeZoneName || TARGET_TIMEZONE;
              if (methodName === 'toDateString') return dateStr;
              if (methodName === 'toTimeString') return timeStr + ' ' + offsetStr + ' (' + tzName + ')';
              return dateStr + ' ' + timeStr + ' ' + offsetStr + ' (' + tzName + ')';
            } catch (e) {
              return original.apply(this, args);
            }
          };
          self.Date.prototype[methodName] = makeNative(patchedMethod, methodName, 0);
        })(methods[mi2]);
      }

      function isParsedAsUTC(str) {
        str = String(str).trim();
        if (/(Z|[+-]\d{2}:?\d{2}|GMT[+-]?\d*)\s*(\(.*\))?\s*$/i.test(str)) return true;
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?)?$/i.test(str)) return true;
        return false;
      }
      function correctedParse(str) {
        var hostEpoch = OriginalDate.parse(str);
        if (isNaN(hostEpoch)) return NaN;
        if (isParsedAsUTC(str)) return hostEpoch;
        var hostOffsetMs = origGetTZOffset.call(new OriginalDate(hostEpoch)) * 60000;
        var targetOffsetMs = targetOffsetMsAt(hostEpoch);
        return hostEpoch + (targetOffsetMs - hostOffsetMs);
      }

      function PatchedDate() {
        var args = arguments;
        if (!(this instanceof PatchedDate)) return new PatchedDate().toString();
        var inst;
        if (args.length === 0) {
          inst = new OriginalDate();
        } else if (args.length === 1) {
          var a0 = args[0];
          inst = new OriginalDate(typeof a0 === 'string' ? correctedParse(a0) : a0);
        } else {
          var y = args[0], mo = args[1] || 0, d = args.length > 2 ? args[2] : 1,
            h = args.length > 3 ? args[3] : 0, mi = args.length > 4 ? args[4] : 0,
            s = args.length > 5 ? args[5] : 0, ms = args.length > 6 ? args[6] : 0;
          if (y >= 0 && y <= 99) y += 1900;
          inst = new OriginalDate(localComponentsToEpoch(y, mo, d, h, mi, s, ms));
        }
        Object.setPrototypeOf(inst, PatchedDate.prototype);
        return inst;
      }
      PatchedDate.prototype = self.Date.prototype;
      try { self.Date.prototype.constructor = PatchedDate; } catch(e) {}
      PatchedDate.now = OriginalDate.now;
      PatchedDate.UTC = OriginalDate.UTC;
      PatchedDate.parse = makeNative(function(str) { return correctedParse(str); }, 'parse', 1);
      makeNative(PatchedDate, 'Date', 7);
      try { Object.defineProperty(self, 'Date', { value: PatchedDate, writable: true, configurable: true }); } catch (e) {}

      if (self.Temporal && self.Temporal.Now) {
        var TemporalNow = self.Temporal.Now;
        Object.defineProperty(TemporalNow, 'timeZoneId', {
          value: makeNative(function() { return TARGET_TIMEZONE; }, 'timeZoneId', 0), writable: true, configurable: true
        });
        ['zonedDateTimeISO', 'plainDateISO', 'plainTimeISO', 'plainDateTimeISO'].forEach(function(methodName) {
          var originalTemporalMethod = TemporalNow[methodName];
          if (typeof originalTemporalMethod !== 'function') return;
          var patchedTemporalMethod = function(tzLike) { return originalTemporalMethod.call(TemporalNow, tzLike || TARGET_TIMEZONE); };
          Object.defineProperty(TemporalNow, methodName, { value: makeNative(patchedTemporalMethod, methodName, 0), writable: true, configurable: true });
        });
      }

      var NavigatorProto = (self.WorkerNavigator && self.WorkerNavigator.prototype) || Object.getPrototypeOf(self.navigator) || self.navigator;
      if (NavigatorProto) {
        var langProps = { language: SPOOFED_LANG, languages: SPOOFED_LANGS };
        Object.keys(langProps).forEach(function(p) {
          var v = langProps[p];
          var getter = makeNative(function() { return v; }, p, 0);
          try { Object.defineProperty(NavigatorProto, p, { get: getter, configurable: true }); } catch (e) {}
        });

        if (TARGET_UA) {
          var spoofedAppVersion = getAppVersion(TARGET_UA);
          var spoofedPlatform = 'Win32';
          if (TARGET_UA.indexOf('Macintosh') !== -1) spoofedPlatform = 'MacIntel';
          else if (TARGET_UA.indexOf('Android') !== -1) spoofedPlatform = 'Linux armv8l';
          else if (TARGET_UA.indexOf('Linux') !== -1) spoofedPlatform = 'Linux x86_64';

          var uaProps = {
            userAgent: TARGET_UA, appVersion: spoofedAppVersion, platform: spoofedPlatform,
            vendor: TARGET_UA.indexOf('Firefox') !== -1 ? '' : 'Google Inc.'
          };
          Object.keys(uaProps).forEach(function(p) {
            var v = uaProps[p];
            var getter = makeNative(function() { return v; }, p, 0);
            try { Object.defineProperty(NavigatorProto, p, { get: getter, configurable: true }); } catch (e) {}
          });
        }
      }
    } catch (e) {}
  }

  function buildWorkerPatchSource(tz, ua) {
    return '(' + __tzGuardWorkerPatch.toString() + ')(' + JSON.stringify(tz) + ', ' + JSON.stringify(ua || '') + ');';
  }

  // ============================================================
  // Service Worker register patch
  // ============================================================
  function patchServiceWorkerRegister(win) {
    try {
      var sw = win.navigator && win.navigator.serviceWorker;
      if (!sw || spoofedSWs.has(sw)) return;
      spoofedSWs.add(sw);

      var originalRegister = sw.register.bind(sw);
      var wrappedRegister = function(scriptURL, options) {
        try {
          var absoluteURL = new win.URL(scriptURL, win.location.href).href;
          win.document.documentElement.dispatchEvent(new win.CustomEvent('tz-guard-sw-register', { detail: absoluteURL }));
        } catch (e) {}
        return originalRegister(scriptURL, options);
      };
      makeNative(wrappedRegister, 'register', 1);
      Object.defineProperty(sw, 'register', { value: wrappedRegister, writable: true, configurable: true });
    } catch (e) {}
  }

  // ============================================================
  // Worker / SharedWorker constructor patches
  // ============================================================
  function patchWorkerConstructors(win) {
    ['Worker', 'SharedWorker'].forEach(function(ctorName) {
      var OriginalCtor = win[ctorName];
      if (!OriginalCtor || spoofedWorkers.has(OriginalCtor)) return;
      spoofedWorkers.add(OriginalCtor);

      var WrappedCtor = function(scriptURL, options) {
        try {
          if (!TARGET_TIMEZONE && !TARGET_UA) {
            return new OriginalCtor(scriptURL, options);
          }
          var absoluteURL = new win.URL(scriptURL, win.location.href).href;
          var patchCode = buildWorkerPatchSource(TARGET_TIMEZONE, TARGET_UA);
          var combined = patchCode + '\nimportScripts(' + JSON.stringify(absoluteURL) + ');';
          var blob = new win.Blob([combined], { type: 'application/javascript' });
          var blobURL = win.URL.createObjectURL(blob);
          return new OriginalCtor(blobURL, options);
        } catch (e) {}
        return new OriginalCtor(scriptURL, options);
      };
      WrappedCtor.prototype = OriginalCtor.prototype;
      try { OriginalCtor.prototype.constructor = WrappedCtor; } catch(e) {}
      makeNative(WrappedCtor, ctorName, 1);
      win[ctorName] = WrappedCtor;
    });
  }

  // ============================================================
  // Temporal API patch
  // ============================================================
  function patchTemporal(win) {
    try {
      if (!win.Temporal || !win.Temporal.Now) return;
      var Now = win.Temporal.Now;
      Object.defineProperty(Now, 'timeZoneId', { value: makeNative(function() { return TARGET_TIMEZONE; }, 'timeZoneId', 0), writable: true, configurable: true });
      ['zonedDateTimeISO', 'plainDateISO', 'plainTimeISO', 'plainDateTimeISO'].forEach(function(methodName) {
        var original = Now[methodName];
        if (typeof original !== 'function') return;
        var patched = function(tzLike) { return original.call(Now, tzLike || TARGET_TIMEZONE); };
        Object.defineProperty(Now, methodName, { value: makeNative(patched, methodName, 0), writable: true, configurable: true });
      });
    } catch (e) {}
  }

  // ============================================================
  // Navigator / User-Agent spoofing
  // ============================================================
  function spoofUserAgent(win, force) {
    try {
      var NavigatorProto = win.Navigator.prototype;
      if (spoofedWindows.has(NavigatorProto) && !force) return;
      spoofedWindows.add(NavigatorProto);

      var spoofedLang = langMap[TARGET_TIMEZONE] || 'en-US';
      var spoofedLangsArr = [spoofedLang, 'en-US'];
      Object.freeze(spoofedLangsArr);

      var langProps = {
        language: spoofedLang,
        languages: spoofedLangsArr
      };
      Object.keys(langProps).forEach(function(prop) {
        var val = langProps[prop];
        var getter = makeNative(function() { return val; }, prop, 0);
        try { Object.defineProperty(NavigatorProto, prop, { get: getter, configurable: true }); } catch (e) {}
      });

      if (!TARGET_UA) return;

      var spoofedAppVersion = getAppVersion(TARGET_UA);
      var spoofedPlatform = 'Win32';
      if (TARGET_UA.indexOf('Macintosh') !== -1) spoofedPlatform = 'MacIntel';
      else if (TARGET_UA.indexOf('Android') !== -1) spoofedPlatform = 'Linux armv8l';
      else if (TARGET_UA.indexOf('Linux') !== -1) spoofedPlatform = 'Linux x86_64';

      var spoofedVendor = TARGET_UA.indexOf('Firefox') !== -1 ? '' : 'Google Inc.';
      var maxTouchPoints = (TARGET_UA.indexOf('Android') !== -1 || TARGET_UA.indexOf('iPhone') !== -1) ? 5 : 0;

      var uaProps = {
        userAgent: TARGET_UA,
        appVersion: spoofedAppVersion,
        platform: spoofedPlatform,
        vendor: spoofedVendor,
        maxTouchPoints: maxTouchPoints
      };

      if (TARGET_UA.indexOf('Firefox') !== -1) {
        var oscpu = 'Windows NT 10.0; Win64; x64';
        if (TARGET_UA.indexOf('Macintosh') !== -1) oscpu = 'Intel Mac OS X 10.15';
        else if (TARGET_UA.indexOf('Linux') !== -1) oscpu = 'Linux x86_64';
        uaProps.oscpu = oscpu;
      }

      Object.keys(uaProps).forEach(function(prop) {
        var val = uaProps[prop];
        var getter = makeNative(function() { return val; }, prop, 0);
        try { Object.defineProperty(NavigatorProto, prop, { get: getter, configurable: true }); } catch (e) {}
      });
    } catch (e) {}
  }

  // ============================================================
  // Full window spoof (Date, Intl, Temporal, UA, Workers)
  // ============================================================
  function spoofWindow(win) {
    try {
      if (!win || spoofedWindows.has(win)) return;
      spoofedWindows.add(win);

      spoofUserAgent(win);

      if (!TARGET_TIMEZONE) {
        patchWorkerConstructors(win);
        patchServiceWorkerRegister(win);
        patchIframeGetters(win);
        patchTemporal(win);
        return;
      }

      var SPOOFED_LANG = langMap[TARGET_TIMEZONE] || 'en-US';
      var SPOOFED_LANGS = Object.freeze([SPOOFED_LANG, 'en-US']);

      var OriginalDate = win.Date;
      var origValueOf = OriginalDate.prototype.valueOf;
      var origSetTime = OriginalDate.prototype.setTime;
      var origGetTZOffset = OriginalDate.prototype.getTimezoneOffset;

      var OriginalDTF = win.Intl.DateTimeFormat;
      var OriginalNF = win.Intl.NumberFormat;

      var offsetFormatter = null;
      var stringFormatter = null;

      function rebuildFormatters() {
        if (!OriginalDTF || !TARGET_TIMEZONE) return;
        offsetFormatter = new OriginalDTF('en-US', {
          timeZone: TARGET_TIMEZONE,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        });
        stringFormatter = new OriginalDTF('en-US', {
          weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false, timeZoneName: 'long', timeZone: TARGET_TIMEZONE
        });
      }
      rebuildFormatters();

      function shiftedUTC(epochMs) {
        var offMs = targetOffsetMsAt(OriginalDate, epochMs);
        return new OriginalDate(epochMs - offMs);
      }

      function targetOffsetMsAt(OriginalDate, epochMs) {
        try {
          var parts = offsetFormatter.formatToParts(new OriginalDate(epochMs));
          var map = {};
          for (var i = 0; i < parts.length; i++) {
            map[parts[i].type] = parts[i].value;
          }
          var y = parseInt(map.year, 10);
          var mo = parseInt(map.month, 10) - 1;
          var d = parseInt(map.day, 10);
          var h = parseInt(map.hour, 10);
          if (h === 24) h = 0;
          var mi = parseInt(map.minute, 10);
          var s = parseInt(map.second, 10);
          var asUTC = OriginalDate.UTC(y, mo, d, h, mi, s, 0);
          return -(asUTC - epochMs);
        } catch (e) {
          return 0;
        }
      }

      function targetOffsetMinutesAt(OriginalDate, epochMs) {
        return Math.round(targetOffsetMsAt(OriginalDate, epochMs) / 60000);
      }

      function localComponentsToEpoch(y, mo, d, h, mi, s, ms) {
        var raw = OriginalDate.UTC(y, mo, d, h, mi, s, ms);
        var offMs = targetOffsetMsAt(OriginalDate, raw);
        var epoch = raw + offMs;
        var offMs2 = targetOffsetMsAt(OriginalDate, epoch);
        if (offMs2 !== offMs) epoch = raw + offMs2;
        return epoch;
      }

      function currentTargetParts(dateInstance) {
        var s = shiftedUTC(origValueOf.call(dateInstance));
        return { y: s.getUTCFullYear(), mo: s.getUTCMonth(), d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes(), sec: s.getUTCSeconds(), ms: s.getUTCMilliseconds() };
      }

      function SpoofedDTF(locales, options) {
        options = options || {};
        if (!(this instanceof SpoofedDTF)) return new SpoofedDTF(locales, options);
        var opts = Object.assign({}, options);
        if (!opts.timeZone) opts.timeZone = TARGET_TIMEZONE;
        if (!locales) locales = SPOOFED_LANG;
        var instance = new OriginalDTF(locales, opts);
        Object.setPrototypeOf(instance, SpoofedDTF.prototype);
        return instance;
      }
      SpoofedDTF.prototype = Object.create(OriginalDTF.prototype);
      SpoofedDTF.prototype.constructor = SpoofedDTF;
      try { OriginalDTF.prototype.constructor = SpoofedDTF; } catch(e) {}
      SpoofedDTF.supportedLocalesOf = OriginalDTF.supportedLocalesOf;
      makeNative(SpoofedDTF, 'DateTimeFormat', 0);
      win.Intl.DateTimeFormat = SpoofedDTF;

      function SpoofedNF(locales, options) {
        options = options || {};
        if (!(this instanceof SpoofedNF)) return new SpoofedNF(locales, options);
        if (!locales) locales = SPOOFED_LANG;
        var instance = new OriginalNF(locales, options);
        Object.setPrototypeOf(instance, SpoofedNF.prototype);
        return instance;
      }
      SpoofedNF.prototype = Object.create(OriginalNF.prototype);
      SpoofedNF.prototype.constructor = SpoofedNF;
      try { OriginalNF.prototype.constructor = SpoofedNF; } catch(e) {}
      SpoofedNF.supportedLocalesOf = OriginalNF.supportedLocalesOf;
      makeNative(SpoofedNF, 'NumberFormat', 0);
      win.Intl.NumberFormat = SpoofedNF;

      var origNumberToLocaleString = win.Number.prototype.toLocaleString;
      win.Number.prototype.toLocaleString = makeNative(function(locales, options) {
        if (!locales) locales = SPOOFED_LANG;
        return origNumberToLocaleString.call(this, locales, options);
      }, 'toLocaleString', 0);

      win.Date.prototype.getTimezoneOffset = makeNative(function getTimezoneOffset() {
        try { return targetOffsetMinutesAt(OriginalDate, origValueOf.call(this)); } catch(e) { return NaN; }
      }, 'getTimezoneOffset', 0);

      var fields = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
      fields.forEach(function(field) {
        var getterName = 'get' + field;
        var utcGetterName = 'getUTC' + field;
        win.Date.prototype[getterName] = makeNative(function() {
          try { return shiftedUTC(origValueOf.call(this))[utcGetterName](); } catch(e) { return NaN; }
        }, getterName, 0);
      });
      win.Date.prototype.getYear = makeNative(function() {
        try { return shiftedUTC(origValueOf.call(this)).getUTCFullYear() - 1900; } catch(e) { return NaN; }
      }, 'getYear', 0);

      function makeSetter(name, argCount, apply) {
        win.Date.prototype[name] = makeNative(function() {
          var p = currentTargetParts(this);
          apply(p, arguments);
          var newEpoch = localComponentsToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.sec, p.ms);
          origSetTime.call(this, newEpoch);
          return origValueOf.call(this);
        }, name, argCount);
      }
      makeSetter('setFullYear', 3, function(p, a) { p.y = a[0]; if (a.length > 1) p.mo = a[1]; if (a.length > 2) p.d = a[2]; });
      makeSetter('setMonth', 2, function(p, a) { p.mo = a[0]; if (a.length > 1) p.d = a[1]; });
      makeSetter('setDate', 1, function(p, a) { p.d = a[0]; });
      makeSetter('setHours', 4, function(p, a) { p.h = a[0]; if (a.length > 1) p.mi = a[1]; if (a.length > 2) p.sec = a[2]; if (a.length > 3) p.ms = a[3]; });
      makeSetter('setMinutes', 3, function(p, a) { p.mi = a[0]; if (a.length > 1) p.sec = a[1]; if (a.length > 2) p.ms = a[2]; });
      makeSetter('setSeconds', 2, function(p, a) { p.sec = a[0]; if (a.length > 1) p.ms = a[1]; });
      makeSetter('setMilliseconds', 1, function(p, a) { p.ms = a[0]; });
      win.Date.prototype.setYear = makeNative(function(y) {
        var p = currentTargetParts(this);
        p.y = y < 100 ? 1900 + y : y;
        var newEpoch = localComponentsToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.sec, p.ms);
        origSetTime.call(this, newEpoch);
        return origValueOf.call(this);
      }, 'setYear', 1);

      var methods = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
      methods.forEach(function(methodName) {
        var original = win.Date.prototype[methodName];
        var patchedMethod = function() {
          var args = Array.from(arguments);
          try {
            if (methodName.indexOf('toLocale') === 0) {
              var locales = args[0] || SPOOFED_LANG;
              var options = args[1];
              options = Object.assign({}, options);
              if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
              return original.call(this, locales, options);
            }
            var parts = stringFormatter.formatToParts(this);
            var map = {};
            parts.forEach(function(p) { map[p.type] = p.value; });
            var offsetMin = win.Date.prototype.getTimezoneOffset.call(this);
            var absMin = Math.abs(offsetMin);
            var offsetHours = String(Math.floor(absMin / 60)).padStart(2, '0');
            var offsetMins = String(absMin % 60).padStart(2, '0');
            var offsetSign = offsetMin <= 0 ? '+' : '-';
            var offsetStr = 'GMT' + offsetSign + offsetHours + offsetMins;
            var dateStr = map.weekday + ' ' + map.month + ' ' + map.day + ' ' + map.year;
            var timeStr = map.hour + ':' + map.minute + ':' + map.second;
            var tzName = map.timeZoneName || TARGET_TIMEZONE;
            if (methodName === 'toDateString') return dateStr;
            if (methodName === 'toTimeString') return timeStr + ' ' + offsetStr + ' (' + tzName + ')';
            return dateStr + ' ' + timeStr + ' ' + offsetStr + ' (' + tzName + ')';
          } catch (e) { return original.apply(this, args); }
        };
        win.Date.prototype[methodName] = makeNative(patchedMethod, methodName, 0);
      });

      function isParsedAsUTC(str) {
        str = String(str).trim();
        if (/(Z|[+-]\d{2}:?\d{2}|GMT[+-]?\d*)\s*(\(.*\))?\s*$/i.test(str)) return true;
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?)?$/i.test(str)) return true;
        return false;
      }
      function correctedParse(str) {
        var hostEpoch = OriginalDate.parse(str);
        if (isNaN(hostEpoch)) return NaN;
        if (isParsedAsUTC(str)) return hostEpoch;
        var hostOffsetMs = origGetTZOffset.call(new OriginalDate(hostEpoch)) * 60000;
        var targetOffsetMs = targetOffsetMsAt(OriginalDate, hostEpoch);
        return hostEpoch + (targetOffsetMs - hostOffsetMs);
      }

      function PatchedDate() {
        var args = arguments;
        if (!(this instanceof PatchedDate)) return new PatchedDate().toString();
        var inst;
        if (args.length === 0) inst = new OriginalDate();
        else if (args.length === 1) {
          var a0 = args[0];
          inst = new OriginalDate(typeof a0 === 'string' ? correctedParse(a0) : a0);
        } else {
          var y = args[0], mo = args[1] || 0, d = args.length > 2 ? args[2] : 1,
            h = args.length > 3 ? args[3] : 0, mi = args.length > 4 ? args[4] : 0,
            s = args.length > 5 ? args[5] : 0, ms = args.length > 6 ? args[6] : 0;
          if (y >= 0 && y <= 99) y += 1900;
          inst = new OriginalDate(localComponentsToEpoch(y, mo, d, h, mi, s, ms));
        }
        Object.setPrototypeOf(inst, PatchedDate.prototype);
        return inst;
      }
      PatchedDate.prototype = win.Date.prototype;
      try { win.Date.prototype.constructor = PatchedDate; } catch(e) {}
      PatchedDate.now = OriginalDate.now;
      PatchedDate.UTC = OriginalDate.UTC;
      PatchedDate.parse = makeNative(function(str) { return correctedParse(str); }, 'parse', 1);
      makeNative(PatchedDate, 'Date', 7);
      try { Object.defineProperty(win, 'Date', { value: PatchedDate, writable: true, configurable: true }); } catch (e) {}

      patchWorkerConstructors(win);
      patchServiceWorkerRegister(win);
      patchIframeGetters(win);
      patchTemporal(win);
    } catch (e) {}
  }

  // ============================================================
  // Iframe getters patch
  // ============================================================
  function patchIframeGetters(win) {
    try {
      var IFrameProto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
      if (!IFrameProto || patchedIframeProtos.has(IFrameProto)) return;
      patchedIframeProtos.add(IFrameProto);
      var cwDescriptor = Object.getOwnPropertyDescriptor(IFrameProto, 'contentWindow');
      if (cwDescriptor && cwDescriptor.get) {
        var originalContentWindowGetter = cwDescriptor.get;
        Object.defineProperty(IFrameProto, 'contentWindow', {
          get: makeNative(function() { var w = originalContentWindowGetter.call(this); if (w) { try { spoofWindow(w); } catch (e) {} } return w; }, 'get contentWindow', 0), configurable: true
        });
      }
      var cdDescriptor = Object.getOwnPropertyDescriptor(IFrameProto, 'contentDocument');
      if (cdDescriptor && cdDescriptor.get) {
        var originalContentDocumentGetter = cdDescriptor.get;
        Object.defineProperty(IFrameProto, 'contentDocument', {
          get: makeNative(function() { var doc = originalContentDocumentGetter.call(this); if (doc && doc.defaultView) { try { spoofWindow(doc.defaultView); } catch (e) {} } return doc; }, 'get contentDocument', 0), configurable: true
        });
      }
    } catch (e) {}
  }

  // ============================================================
  // Config application
  // ============================================================
  function applyConfig(cfg) {
    EXTENSION_ENABLED = cfg.enabled !== false;
    SPOOF_HEADERS = cfg.spoofHeaders !== false;

    if (!EXTENSION_ENABLED) return;

    var tzChanged = cfg.tz !== TARGET_TIMEZONE;
    var uaChanged = cfg.ua !== TARGET_UA;

    if (hasAppliedPatches && (tzChanged || uaChanged)) {
        spoofedWindows = new WeakSet();
        spoofedSWs = new WeakSet();
        spoofedWorkers = new WeakSet();
        patchedIframeProtos = new WeakSet();
    }

    TARGET_TIMEZONE = cfg.tz || '';
    TARGET_UA = cfg.ua || '';

    if (!hasAppliedPatches) {
        hasAppliedPatches = true;
        initAll();
    } else {
        if (tzChanged || uaChanged) {
            spoofWindow(window);
            // Перепатчить уже существующие iframes
            try {
                var iframes = document.querySelectorAll('iframe');
                for (var i = 0; i < iframes.length; i++) {
                    if (iframes[i].contentWindow) spoofWindow(iframes[i].contentWindow);
                }
            } catch (e) {}
        }
    }
  }

  

  function initAll() {
    if (!EXTENSION_ENABLED) return;
    spoofWindow(window);
    function handleIframe(node) {
      try {
        if (node.contentWindow) spoofWindow(node.contentWindow);
        node.addEventListener('load', function() {
          if (node.contentWindow) spoofWindow(node.contentWindow);
        });
      } catch (e) {}
    }
    function scanForIframes(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === 'IFRAME') handleIframe(node);
      if (typeof node.querySelectorAll === 'function') {
        var nested = node.querySelectorAll('iframe');
        for (var k = 0; k < nested.length; k++) handleIframe(nested[k]);
      }
    }
    if (document.documentElement) scanForIframes(document.documentElement);

    if (iframeObserver) {
      try { iframeObserver.disconnect(); } catch(e) {}
    }
    iframeObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        for (var j = 0; j < mutation.addedNodes.length; j++)
          scanForIframes(mutation.addedNodes[j]);
      }
    });
    if (document.documentElement) iframeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ============================================================
  // Synchronous config read from DOM attributes
  // ============================================================
  function readConfigFromDOM() {
    var tz = document.documentElement.getAttribute('data-tz-guard-tz') || '';
    var ua = document.documentElement.getAttribute('data-tz-guard-ua') || '';
    var enabled = document.documentElement.getAttribute('data-tz-guard-enabled');
    var spoofHeaders = document.documentElement.getAttribute('data-tz-guard-spoof-headers');
    return {
      tz: tz,
      ua: ua,
      enabled: enabled !== 'false',
      spoofHeaders: spoofHeaders !== 'false'
    };
  }

  function readConfigFromStorage() {
    try {
        var raw = window.sessionStorage.getItem('__tzGuardConfig')
               || window.localStorage.getItem('__tzGuardConfig');
        if (raw) {
            var cfg = JSON.parse(raw);
            return {
                tz: cfg.tz || '',
                ua: cfg.ua || '',
                enabled: cfg.enabled !== false,
                spoofHeaders: cfg.spoofHeaders !== false
            };
        }
    } catch (e) {}
    return null;
  }

  // ============================================================
  // STARTUP: synchronous DOM-first, no async, no browser API
  // ============================================================
  var domCfg = readConfigFromDOM();
  var storageCfg = readConfigFromStorage();
  var root = document.documentElement;
  var hasDOMConfig = root && root.getAttribute('data-tz-guard-enabled') !== null;

  if (hasDOMConfig) {
     applyConfig(domCfg);
  }  else if (storageCfg) {
    applyConfig(storageCfg);
  } else {
    var bridgeHandler = function(e) {
        try {
            var cfg = JSON.parse(e.detail);
            applyConfig(cfg);
            // Сохраняем в storage для следующих перезагрузок
            try {
                var cfgStr = JSON.stringify(cfg);
                window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
                window.localStorage.setItem('__tzGuardConfig', cfgStr);
            } catch(err) {}
            if (document.documentElement) {
                document.documentElement.removeEventListener('tz-guard-update-config', bridgeHandler);
            }
        } catch (err) {}
    };
    if (document.documentElement) {
        document.documentElement.addEventListener('tz-guard-update-config', bridgeHandler);
    } else {
        var checkRoot = setInterval(function() {
            if (document.documentElement) {
                clearInterval(checkRoot);
                document.documentElement.addEventListener('tz-guard-update-config', bridgeHandler);
            }
        }, 1);
    }
  }

  // Always patch Worker constructors immediately so they catch up when config arrives
  patchWorkerConstructors(window);
  patchServiceWorkerRegister(window);
  patchIframeGetters(window);

  // ============================================================
  // PAGESHOW (bfcache restore): synchronous restore, no browser API
  // ============================================================
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) {
      // Reset WeakSets so patches apply again to restored objects
      spoofedWindows = new WeakSet();
      spoofedSWs = new WeakSet();
      spoofedWorkers = new WeakSet();
      patchedIframeProtos = new WeakSet();
      hasAppliedPatches = false;

      // Re-apply immediate patches
      patchWorkerConstructors(window);
      patchServiceWorkerRegister(window);
      patchIframeGetters(window);

      // Synchronous restore from DOM attributes (they survived bfcache)
      var cfg = readConfigFromDOM();
      applyConfig(cfg);
    }
  });
})();