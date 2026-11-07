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

  // Saved natives for FULL "off" restoration (master toggle / exception
  // sites): whenever a patch replaces something, the original is recorded
  // here so a disable event can undo every patch in one shot.
  var workerRestores = [];   // { win, ctorName, original }
  var swRestores = [];       // { sw, descriptor }
  var iframeRestores = [];   // { proto, cwDescriptor, cdDescriptor }
  var temporalRestores = []; // { obj, prop, descriptor }
  var navigatorOriginalDescs = new Map(); // NavigatorProto -> { prop: descriptor }
  var propertyRestores = []; // { obj, prop, descriptor } — generic replaced props

  // Capture the current (native) descriptor of a property BEFORE it is
  // replaced, so restoreNativePatches() can put the exact original back.
  function recordReplace(obj, prop) {
    try {
      propertyRestores.push({ obj: obj, prop: prop, descriptor: Object.getOwnPropertyDescriptor(obj, prop) });
    } catch (e) {}
  }

  var langMap = {
    'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
    'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
    'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
  };

  function spoofLanguagesList(lang) {
    // Single language only — creepjs flags any extra/secondary languages
    // in workers (default Firefox exposes exactly one here).
    return Object.freeze([lang]);
  }

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
  // неконструируемый shorthand-метод вместо Proxy
  var wrapper = ({ [fnName](...a) { return fn.apply(this, a); } })[fnName];
  Object.defineProperty(wrapper, 'toString', { value: function() { return str; }, writable: true, configurable: true });
  try {
    Object.defineProperty(wrapper, 'name', { value: fnName, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: length, configurable: true });
  } catch (e) {}
  return wrapper;
}

function patchNativeLook(fn, name, length) {
  var str = 'function ' + name + '() {\n    [native code]\n}';
  try {
    Object.defineProperty(fn, 'toString', { value: function() { return str; }, writable: true, configurable: true });
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    Object.defineProperty(fn, 'length', { value: length, configurable: true });
  } catch (e) {}
  return fn;
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
      var SPOOFED_LANGS = Object.freeze([SPOOFED_LANG]);

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
  // неконструируемый shorthand-метод вместо Proxy
  var wrapper = ({ [fnName](...a) { return fn.apply(this, a); } })[fnName];
  Object.defineProperty(wrapper, 'toString', { value: function() { return str; }, writable: true, configurable: true });
  try {
    Object.defineProperty(wrapper, 'name', { value: fnName, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: length, configurable: true });
  } catch (e) {}
  return wrapper;
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

      // CreepJS collects resolvedOptions().locale of default-constructed
      // Intl constructors — every one of them must resolve to SPOOFED_LANG.
      ['Collator', 'DisplayNames', 'ListFormat', 'PluralRules', 'RelativeTimeFormat'].forEach(function(name) {
        var OriginalIntlCtor = self.Intl[name];
        if (typeof OriginalIntlCtor !== 'function') return;
        function SpoofedIntlCtor(locales, options) {
          if (!(this instanceof SpoofedIntlCtor)) return new SpoofedIntlCtor(locales, options);
          if (!locales) locales = SPOOFED_LANG;
          var inst = new OriginalIntlCtor(locales, options);
          // SpiderMonkey quirk: Firefox resolves Collator('fi-FI') -> 'fi' (strips the region),
          // breaking the "one locale" fingerprint. Force the full tag.
          if (name === 'Collator') {
            var origRO = inst.resolvedOptions;
            inst.resolvedOptions = makeNative(function() {
              var res = origRO.call(inst);
              try { res.locale = SPOOFED_LANG; } catch (err) {}
              return res;
            }, 'resolvedOptions', 0);
          }
          return inst;
        }
        SpoofedIntlCtor.prototype = OriginalIntlCtor.prototype;
        try { OriginalIntlCtor.prototype.constructor = SpoofedIntlCtor; } catch(e) {}
        SpoofedIntlCtor.supportedLocalesOf = OriginalIntlCtor.supportedLocalesOf;
        makeNative(SpoofedIntlCtor, name, 0);
        self.Intl[name] = SpoofedIntlCtor;
      });

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
      patchNativeLook(PatchedDate, 'Date', 7);
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

      var swDesc = null;
      try { swDesc = Object.getOwnPropertyDescriptor(sw, 'register'); } catch (e0) {}
      swRestores.push({ sw: sw, descriptor: swDesc });

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
      workerRestores.push({ win: win, ctorName: ctorName, original: OriginalCtor });

      var WrappedCtor = function(scriptURL, options) {
        try {
          if (!TARGET_TIMEZONE && !TARGET_UA) {
            return new OriginalCtor(scriptURL, options);
          }
          // Only rewrite classic http(s) workers: blob:/data: sources must
          // pass through untouched (their context CSP is not ours to satisfy,
          // importScripts from blob: fails, and strict challengers break).
          var absoluteURL = new win.URL(scriptURL, win.location.href).href;
          if (!/^(https?:|wss?:)/i.test(absoluteURL) || (options && options.type === 'module')) {
            return new OriginalCtor(scriptURL, options);
          }
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
      if (!EXTENSION_ENABLED) return;
      if (!win.Temporal || !win.Temporal.Now) return;
      var Now = win.Temporal.Now;
      var tzDesc = null;
      try { tzDesc = Object.getOwnPropertyDescriptor(Now, 'timeZoneId'); } catch (e0) {}
      temporalRestores.push({ obj: Now, prop: 'timeZoneId', descriptor: tzDesc });
      Object.defineProperty(Now, 'timeZoneId', { value: makeNative(function() { return TARGET_TIMEZONE; }, 'timeZoneId', 0), writable: true, configurable: true });
      ['zonedDateTimeISO', 'plainDateISO', 'plainTimeISO', 'plainDateTimeISO'].forEach(function(methodName) {
        var original = Now[methodName];
        if (typeof original !== 'function') return;
        var methodDesc = null;
        try { methodDesc = Object.getOwnPropertyDescriptor(Now, methodName); } catch (e1) {}
        temporalRestores.push({ obj: Now, prop: methodName, descriptor: methodDesc });
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
      if (!navigatorOriginalDescs.has(NavigatorProto)) {
        // First patch of this proto: capture native descriptors so the
        // getters below can fall back to real values on disable, and
        // restoreNativePatches() can defineProperty everything back.
        var captured = {};
        var probeProps = ['language', 'languages', 'userAgent', 'appVersion', 'platform', 'vendor', 'maxTouchPoints', 'oscpu'];
        for (var pi = 0; pi < probeProps.length; pi++) {
          var pName = probeProps[pi];
          var pDesc = null;
          try { pDesc = Object.getOwnPropertyDescriptor(NavigatorProto, pName); } catch (e0) {}
          if (pDesc) captured[pName] = pDesc;
        }
        navigatorOriginalDescs.set(NavigatorProto, captured);
      }

      var spoofedLang = langMap[TARGET_TIMEZONE] || 'en-US';
      var spoofedLangsArr = spoofLanguagesList(spoofedLang);

      var langProps = {
        language: spoofedLang,
        languages: spoofedLangsArr
      };
      Object.keys(langProps).forEach(function(prop) {
        var val = langProps[prop];
        var getter = makeNative(function() {
          if (!EXTENSION_ENABLED) {
            var d = navigatorOriginalDescs.get(NavigatorProto);
            if (d && d[prop] && d[prop].get) return d[prop].get.call(this);
            return val;
          }
          return val;
        }, prop, 0);
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
        var getter = makeNative(function() {
          if (!EXTENSION_ENABLED) {
            var d = navigatorOriginalDescs.get(NavigatorProto);
            if (d && d[prop] && d[prop].get) return d[prop].get.call(this);
            return val;
          }
          return val;
        }, prop, 0);
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
      if (!EXTENSION_ENABLED) return;
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
      recordReplace(win.Intl, 'DateTimeFormat');
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
      recordReplace(win.Intl, 'NumberFormat');
      win.Intl.NumberFormat = SpoofedNF;

      // CreepJS collects resolvedOptions().locale of default-constructed
      // Intl constructors — every one of them must resolve to SPOOFED_LANG.
      ['Collator', 'DisplayNames', 'ListFormat', 'PluralRules', 'RelativeTimeFormat'].forEach(function(name) {
        var OriginalIntlCtor = win.Intl[name];
        if (typeof OriginalIntlCtor !== 'function') return;
        function SpoofedIntlCtor(locales, options) {
          if (!(this instanceof SpoofedIntlCtor)) return new SpoofedIntlCtor(locales, options);
          if (!EXTENSION_ENABLED) return new OriginalIntlCtor(locales, options);
          if (!locales) locales = SPOOFED_LANG;
          var inst = new OriginalIntlCtor(locales, options);
          // SpiderMonkey quirk: Firefox resolves Collator('fi-FI') -> 'fi' (strips the region),
          // breaking the "one locale" fingerprint. Force the full tag.
          if (name === 'Collator') {
            var origRO = inst.resolvedOptions;
            inst.resolvedOptions = makeNative(function() {
              var res = origRO.call(inst);
              try { res.locale = SPOOFED_LANG; } catch (err) {}
              return res;
            }, 'resolvedOptions', 0);
          }
          return inst;
        }
        SpoofedIntlCtor.prototype = OriginalIntlCtor.prototype;
        try { OriginalIntlCtor.prototype.constructor = SpoofedIntlCtor; } catch(e) {}
        SpoofedIntlCtor.supportedLocalesOf = OriginalIntlCtor.supportedLocalesOf;
        makeNative(SpoofedIntlCtor, name, 0);
        recordReplace(win.Intl, name);
        win.Intl[name] = SpoofedIntlCtor;
      });

      var origNumberToLocaleString = win.Number.prototype.toLocaleString;
      recordReplace(win.Number.prototype, 'toLocaleString');
      win.Number.prototype.toLocaleString = makeNative(function(locales, options) {
        if (!EXTENSION_ENABLED) return origNumberToLocaleString.call(this, locales, options);
        if (!locales) locales = SPOOFED_LANG;
        return origNumberToLocaleString.call(this, locales, options);
      }, 'toLocaleString', 0);

      recordReplace(win.Date.prototype, 'getTimezoneOffset');
      win.Date.prototype.getTimezoneOffset = makeNative(function getTimezoneOffset() {
        if (!EXTENSION_ENABLED) return origGetTZOffset.call(this);
        try { return targetOffsetMinutesAt(OriginalDate, origValueOf.call(this)); } catch(e) { return NaN; }
      }, 'getTimezoneOffset', 0);

      var fields = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
      fields.forEach(function(field) {
        var getterName = 'get' + field;
        var origGetter = OriginalDate.prototype[getterName];
        var utcGetterName = 'getUTC' + field;
        recordReplace(win.Date.prototype, getterName);
        win.Date.prototype[getterName] = makeNative(function() {
          if (!EXTENSION_ENABLED) return origGetter.call(this);
          try { return shiftedUTC(origValueOf.call(this))[utcGetterName](); } catch(e) { return NaN; }
        }, getterName, 0);
      });
      var origGetYear = OriginalDate.prototype.getYear;
      recordReplace(win.Date.prototype, 'getYear');
      win.Date.prototype.getYear = makeNative(function() {
        if (!EXTENSION_ENABLED) return origGetYear.call(this);
        try { return shiftedUTC(origValueOf.call(this)).getUTCFullYear() - 1900; } catch(e) { return NaN; }
      }, 'getYear', 0);

      function makeSetter(name, argCount, apply) {
        var origSetter = OriginalDate.prototype[name];
        recordReplace(win.Date.prototype, name);
        win.Date.prototype[name] = makeNative(function() {
          if (!EXTENSION_ENABLED) return origSetter.apply(this, arguments);
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
      var origSetYear = OriginalDate.prototype.setYear;
      recordReplace(win.Date.prototype, 'setYear');
      win.Date.prototype.setYear = makeNative(function(y) {
        if (!EXTENSION_ENABLED) return origSetYear.call(this, y);
        var p = currentTargetParts(this);
        p.y = y < 100 ? 1900 + y : y;
        var newEpoch = localComponentsToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.sec, p.ms);
        origSetTime.call(this, newEpoch);
        return origValueOf.call(this);
      }, 'setYear', 1);

      var methods = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
      methods.forEach(function(methodName) {
        var original = win.Date.prototype[methodName];
        recordReplace(win.Date.prototype, methodName);
        var patchedMethod = function() {
          var args = Array.from(arguments);
          if (!EXTENSION_ENABLED) return original.apply(this, args);
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
      recordReplace(win.Date.prototype, 'constructor');
      try { win.Date.prototype.constructor = PatchedDate; } catch(e) {}
      PatchedDate.now = OriginalDate.now;
      PatchedDate.UTC = OriginalDate.UTC;
      PatchedDate.parse = makeNative(function(str) { return correctedParse(str); }, 'parse', 1);
      patchNativeLook(PatchedDate, 'Date', 7);
      recordReplace(win, 'Date');
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
      iframeRestores.push({ proto: IFrameProto, cwDescriptor: cwDescriptor, cdDescriptor: cdDescriptor });
    } catch (e) {}
  }

  // ============================================================
  // Full "off" restoration: undo every recorded patch so a disabled
  // frame (master toggle / exception site) returns to a pristine
  // native state even mid-page.
  // ============================================================
  function restoreNativePatches() {
    try {
      var i;
      for (i = 0; i < workerRestores.length; i++) {
        var wr = workerRestores[i];
        try { wr.win[wr.ctorName] = wr.original; } catch (e) {}
        try { if (wr.win[wr.ctorName]) wr.win[wr.ctorName].prototype.constructor = wr.original; } catch (e2) {}
      }
      for (i = 0; i < swRestores.length; i++) {
        var sr = swRestores[i];
        try {
          if (sr.descriptor) Object.defineProperty(sr.sw, 'register', sr.descriptor);
          else { try { delete sr.sw.register; } catch (e2) {} }
        } catch (e) {}
      }
      for (i = 0; i < iframeRestores.length; i++) {
        var ir = iframeRestores[i];
        try {
          if (ir.cwDescriptor) Object.defineProperty(ir.proto, 'contentWindow', ir.cwDescriptor);
        } catch (e) {}
        try {
          if (ir.cdDescriptor) Object.defineProperty(ir.proto, 'contentDocument', ir.cdDescriptor);
        } catch (e) {}
      }
      for (i = 0; i < temporalRestores.length; i++) {
        var tr = temporalRestores[i];
        try {
          if (tr.descriptor) Object.defineProperty(tr.obj, tr.prop, tr.descriptor);
          else { try { delete tr.obj[tr.prop]; } catch (e2) {} }
        } catch (e) {}
      }
      navigatorOriginalDescs.forEach(function(props, proto) {
        Object.keys(props).forEach(function(prop) {
          try {
            if (props[prop]) Object.defineProperty(proto, prop, props[prop]);
            else { try { delete proto[prop]; } catch (e2) {} }
          } catch (e) {}
        });
      });
      for (i = propertyRestores.length - 1; i >= 0; i--) {
        var pr = propertyRestores[i];
        try {
          if (pr.descriptor) Object.defineProperty(pr.obj, pr.prop, pr.descriptor);
          else { try { delete pr.obj[pr.prop]; } catch (e2) {} }
        } catch (e) {}
      }
    } catch (err) {}
    workerRestores.length = 0;
    swRestores.length = 0;
    iframeRestores.length = 0;
    temporalRestores.length = 0;
    propertyRestores.length = 0;
    navigatorOriginalDescs = new Map();
    spoofedWindows = new WeakSet();
    spoofedSWs = new WeakSet();
    spoofedWorkers = new WeakSet();
    patchedIframeProtos = new WeakSet();
    hasAppliedPatches = false;
    TARGET_TIMEZONE = '';
    TARGET_UA = '';
  }

  function applyConfig(cfg) {
    EXTENSION_ENABLED = cfg.enabled !== false;
    SPOOF_HEADERS = cfg.spoofHeaders !== false;

    // Per-frame self-check: the bridge's isolated world cannot reliably
    // read cross-origin ancestors, so never trust its verdict blindly.
    // This MAIN-world chain CAN read parent.location.href (spec: href
    // is cross-origin readable), e.g. the Turnstile iframe inside an
    // excepted ip.cx sees [cf-host, ip.cx] and stays native.
    if (EXTENSION_ENABLED && Array.isArray(cfg.whitelist) && cfg.whitelist.length > 0 &&
        !isSiteAllowed(__hostChain, cfg.whitelist)) {
      EXTENSION_ENABLED = false;
    } else if (EXTENSION_ENABLED && (!Array.isArray(cfg.whitelist) || cfg.whitelist.length === 0) &&
               storageCfg && Array.isArray(storageCfg.whitelist) && storageCfg.whitelist.length > 0) {
      // DOM-marker startup path carries no list of its own — fall back to
      // the last cached list rather than trusting an unqualified "enabled".
      if (!isSiteAllowed(__hostChain, storageCfg.whitelist)) EXTENSION_ENABLED = false;
    }

    if (!EXTENSION_ENABLED) {
      restoreNativePatches();
      return;
    }

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
  // Host chain: own hostname + all ancestor hostnames. For
  // cross-origin ancestors location.hostname is NOT readable, but
  // location.href IS (spec allows reading href across origins) —
  // parse the hostname out of it. Frames spawned by an exception
  // site therefore inherit its status automatically.
  function __hostnameFromUrl(u) {
    return String(u || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
  }

  function __readWinHost(win) {
    try {
      var h = win.location.hostname;
      if (h) return String(h).toLowerCase();
    } catch (e) {}
    try {
      var href = win.location.href;
      if (href) return __hostnameFromUrl(href);
    } catch (e2) {}
    return '';
  }

  var __hostChain = (function() {
    var hosts = [];
    var w = window;
    try {
      for (var d = 0; d < 16; d++) {
        var h = __readWinHost(w);
        if (h) hosts.push(h);
        if (w === w.top) break;
        var p = w.parent;
        if (!p || p === w) break;
        w = p;
      }
    } catch (err) {}
    return hosts;
  })();

  // Must stay in sync with bridge.js / background.js (same matching rules).
  // The list is an EXCEPTION list: spoofing is ON everywhere by default,
  // and the listed sites (plus their subdomains AND the frames they spawn)
  // stay completely native — status is inherited down the frame chain.
  function isSiteAllowed(hosts, whitelist) {
    if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
    var list = Array.isArray(hosts) ? hosts : [hosts];
    for (var i = 0; i < list.length; i++) {
      var host = String(list[i] || '').toLowerCase();
      if (!host) continue;
      for (var j = 0; j < whitelist.length; j++) {
        var e = String(whitelist[j]).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
        if (!e) continue;
        if (host === e || host.slice(-(e.length + 1)) === '.' + e) return false;
      }
    }
    return true;
  }

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
            // Legacy configs (before the exception-list feature) carry no whitelist —
            // never trust them: they may miss exception sites that must stay native.
            if (!Array.isArray(cfg.whitelist)) return null;
            var allowed = isSiteAllowed(__hostChain, cfg.whitelist);
            return {
                tz: cfg.tz || '',
                ua: cfg.ua || '',
                enabled: cfg.enabled !== false && allowed,
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

  // Live config channel: attached in ALL cases. The DOM/storage paths are
  // heuristic caches for the synchronous start; the bridge event is the
  // authoritative async config (also covers a "real" disable taking over
  // from a stale cache — restoreNativePatches() undoes any early patches).
  var bridgeHandler = function(e) {
    try {
      var cfg = JSON.parse(e.detail);
      applyConfig(cfg);
      // Keep the page-storage cache in sync for the next synchronous start
      try {
        var cfgStr = JSON.stringify(cfg);
        window.sessionStorage.setItem('__tzGuardConfig', cfgStr);
        window.localStorage.setItem('__tzGuardConfig', cfgStr);
      } catch (err) {}
    } catch (err2) {}
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

  if (hasDOMConfig) {
    if (domCfg.enabled === false) {
      // Disabled / exception site: strip the bridge's injection markers
      // right away so the page carries no post-load trace.
      try {
        root.removeAttribute('data-tz-guard-tz');
        root.removeAttribute('data-tz-guard-ua');
        root.removeAttribute('data-tz-guard-enabled');
        root.removeAttribute('data-tz-guard-spoof-headers');
      } catch (e) {}
    }
    applyConfig(domCfg);
  }  else if (storageCfg) {
    applyConfig(storageCfg);
  }

  // Wrap constructors only when the site is (or may be) allowed:
  // on known exception sites the environment stays 100% pristine,
  // because even a transparent-looking wrapper is detectable.
  var knownAllowed = (
    hasDOMConfig ? (domCfg.enabled !== false) :
      storageCfg ? (storageCfg.enabled !== false) : null
  );
  if (knownAllowed !== false) {
    patchWorkerConstructors(window);
    patchServiceWorkerRegister(window);
    patchIframeGetters(window);
  }

  // ============================================================
  // PAGESHOW (bfcache restore): synchronous restore, no browser API
  // ============================================================
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) {
      // No injection markers = exception site / globally disabled:
      // nothing was ever patched, stay pristine on restore.
      try {
        if (document.documentElement.getAttribute('data-tz-guard-enabled') === null) return;
      } catch (err) { return; }

      // Reset WeakSets so patches apply again to restored objects
      spoofedWindows = new WeakSet();
      spoofedSWs = new WeakSet();
      spoofedWorkers = new WeakSet();
      patchedIframeProtos = new WeakSet();
      hasAppliedPatches = false;

      // Synchronous restore from DOM attributes (they survived bfcache)
      var cfg = readConfigFromDOM();
      // Re-apply immediate patches only when the site is allowed
      if (cfg.enabled !== false) {
        patchWorkerConstructors(window);
        patchServiceWorkerRegister(window);
        patchIframeGetters(window);
      }
      applyConfig(cfg);
    }
  });
})();