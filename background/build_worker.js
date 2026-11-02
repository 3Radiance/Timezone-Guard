// Сериализуется через Function.prototype.toString — без ручного экранирования.

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

    function patchNativeLook(fn, name, length) {
      var str = 'function ' + name + '() {\n    [native code]\n}';
      try {
        Object.defineProperty(fn, 'toString', { value: function() { return str; }, writable: true, configurable: true });
        Object.defineProperty(fn, 'name', { value: name, configurable: true });
        Object.defineProperty(fn, 'length', { value: length, configurable: true });
      } catch (e) {}
      return fn;
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
        for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
        var y = parseInt(map.year, 10);
        var mo = parseInt(map.month, 10) - 1;
        var d = parseInt(map.day, 10);
        var h = parseInt(map.hour, 10);
        if (h === 24) h = 0;
        var mi = parseInt(map.minute, 10);
        var s = parseInt(map.second, 10);
        var asUTC = OriginalDate.UTC(y, mo, d, h, mi, s, 0);
        return -(asUTC - epochMs);
      } catch (e) { return 0; }
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
      try { return targetOffsetMinutesAt(origValueOf.call(this)); } catch(e) { return NaN; }
    }, 'getTimezoneOffset', 0);

    var fields = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
    for (var fi = 0; fi < fields.length; fi++) {
      (function(field) {
        var getterName = 'get' + field;
        var utcGetterName = 'getUTC' + field;
        self.Date.prototype[getterName] = makeNative(function() {
          try { return shiftedUTC(origValueOf.call(this))[utcGetterName](); } catch(e) { return NaN; }
        }, getterName, 0);
      })(fields[fi]);
    }
    self.Date.prototype.getYear = makeNative(function() {
      try { return shiftedUTC(origValueOf.call(this)).getUTCFullYear() - 1900; } catch(e) { return NaN; }
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
          } catch (e) { return original.apply(this, args); }
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

export function buildWorkerPatchSource(tz, ua) {
  return '(' + __tzGuardWorkerPatch.toString() + ')(' + JSON.stringify(tz) + ', ' + JSON.stringify(ua || '') + ');';
}