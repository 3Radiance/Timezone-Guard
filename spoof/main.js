(function() {
  'use strict';

  var TARGET_TIMEZONE = document.documentElement.getAttribute('data-tz-guard-tz') || 'Europe/Helsinki';
  var TARGET_UA = document.documentElement.getAttribute('data-tz-guard-ua') || '';
  document.documentElement.removeAttribute('data-tz-guard-tz');
  document.documentElement.removeAttribute('data-tz-guard-ua');

  var spoofedWindows = new WeakSet();
  var spoofedSWs = new WeakSet();
  var spoofedWorkers = new WeakSet();

  var langMap = {
    'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
    'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
    'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
  };

  function makeNative(fn, name, length) {
    length = length || 0;
    var str = 'function ' + (name || fn.name || '') + '() { [native code] }';
    Object.defineProperty(fn, 'toString', {
      value: function toString() { return str; },
      writable: true,
      configurable: true
    });
    try {
      Object.defineProperty(fn, 'name', { value: name || fn.name, configurable: true });
      Object.defineProperty(fn, 'length', { value: length, configurable: true });
    } catch(e) {}
    return fn;
  }

  document.documentElement.addEventListener('tz-guard-update-config', function(e) {
    try {
      var newCfg = JSON.parse(e.detail);
      TARGET_TIMEZONE = newCfg.tz;
      TARGET_UA = newCfg.ua;
      rebuildFormatters(cachedOriginalDTF);
      spoofUserAgent(window, true);
    } catch(err) {}
  });

  var offsetFormatter = null;
  var stringFormatter = null;
  var cachedOriginalDTF = null;

  function rebuildFormatters(OriginalDTF) {
    if (!OriginalDTF) return;
    cachedOriginalDTF = OriginalDTF;
    offsetFormatter = new OriginalDTF('en-US', {
      timeZone: TARGET_TIMEZONE,
      timeZoneName: 'shortOffset',
      hour12: false
    });
    stringFormatter = new OriginalDTF('en-US', {
      timeZone: TARGET_TIMEZONE,
      weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'long'
    });
  }

  function spoofUserAgent(win, force) {
    try {
      var NavigatorProto = win.Navigator.prototype;
      if (spoofedWindows.has(NavigatorProto) && !force) return;
      spoofedWindows.add(NavigatorProto);

      if (!TARGET_UA) return;

      var spoofedAppVersion = TARGET_UA.indexOf('Mozilla/') === 0 ? TARGET_UA.substring(8) : TARGET_UA;
      var spoofedPlatform = 'Win32';
      if (TARGET_UA.indexOf('Macintosh') !== -1) spoofedPlatform = 'MacIntel';
      else if (TARGET_UA.indexOf('Android') !== -1) spoofedPlatform = 'Linux armv8l';
      else if (TARGET_UA.indexOf('Linux') !== -1) spoofedPlatform = 'Linux x86_64';

      var spoofedVendor = TARGET_UA.indexOf('Firefox') !== -1 ? '' : 'Google Inc.';
      var spoofedLang = langMap[TARGET_TIMEZONE] || 'en-US';
      var spoofedLangsArr = [spoofedLang, 'en-US'];
      Object.freeze(spoofedLangsArr);

      var isMobile = TARGET_UA.indexOf('Mobile') !== -1 || TARGET_UA.indexOf('Android') !== -1;
      var maxTouchPoints = (TARGET_UA.indexOf('Android') !== -1 || TARGET_UA.indexOf('iPhone') !== -1) ? 5 : 0;

      var props = {
        userAgent: TARGET_UA,
        appVersion: spoofedAppVersion,
        platform: spoofedPlatform,
        vendor: spoofedVendor,
        language: spoofedLang,
        languages: spoofedLangsArr,
        maxTouchPoints: maxTouchPoints
      };

      if (TARGET_UA.indexOf('Firefox') !== -1) {
        var oscpu = 'Windows NT 10.0; Win64; x64';
        if (TARGET_UA.indexOf('Macintosh') !== -1) oscpu = 'Intel Mac OS X 10.15';
        else if (TARGET_UA.indexOf('Linux') !== -1) oscpu = 'Linux x86_64';
        props.oscpu = oscpu;
      }

      Object.keys(props).forEach(function(prop) {
        var val = props[prop];
        var getter = makeNative(function() { return val; }, prop, 0);
        try { Object.defineProperty(NavigatorProto, prop, { get: getter, configurable: true }); } catch(e) {}
      });

      if (TARGET_UA.indexOf('Chrome') !== -1 && win.navigator.userAgentData) {
        var platform = TARGET_UA.indexOf('Windows') !== -1 ? 'Windows' : (TARGET_UA.indexOf('Macintosh') !== -1 ? 'macOS' : (TARGET_UA.indexOf('Android') !== -1 ? 'Android' : 'Linux'));
        var majorVersion = (TARGET_UA.match(/Chrome\/(\d+)/) || [])[1] || '124';
        var fullVersion = (TARGET_UA.match(/Chrome\/([\d.]+)/) || [])[1] || (majorVersion + '.0.0.0');
        var isArm = TARGET_UA.indexOf('arm') !== -1 || TARGET_UA.indexOf('Android') !== -1;
        var arch = isArm ? 'arm' : 'x86';
        var bitness = isArm ? '' : '64';
        var platformVersion = platform === 'Windows' ? '15.0.0' : '14.0.0';

        var brands = [
          { brand: 'Chromium', version: majorVersion },
          { brand: 'Google Chrome', version: majorVersion },
          { brand: 'Not-A.Brand', version: '99' }
        ];

        var uaDataGetter = makeNative(function() {
          var obj = {
            brands: brands,
            mobile: isMobile,
            platform: platform,
            getHighEntropyValues: makeNative(async function(hints) {
              hints = hints || [];
              var result = { brands: brands, mobile: isMobile, platform: platform };
              if (hints.indexOf('architecture') !== -1) result.architecture = arch;
              if (hints.indexOf('bitness') !== -1) result.bitness = bitness;
              if (hints.indexOf('model') !== -1) result.model = '';
              if (hints.indexOf('platformVersion') !== -1) result.platformVersion = platformVersion;
              if (hints.indexOf('uaFullVersion') !== -1) result.uaFullVersion = fullVersion;
              if (hints.indexOf('fullVersionList') !== -1) {
                result.fullVersionList = [
                  { brand: 'Chromium', version: fullVersion },
                  { brand: 'Google Chrome', version: fullVersion },
                  { brand: 'Not-A.Brand', version: '99.0.0.0' }
                ];
              }
              return result;
            }, 'getHighEntropyValues', 1),
            toJSON: makeNative(function() { return { brands: brands, mobile: isMobile, platform: platform }; }, 'toJSON', 0)
          };
          Object.defineProperty(obj, Symbol.toStringTag, { value: 'NavigatorUAData' });
          return obj;
        }, 'userAgentData', 0);

        try { Object.defineProperty(NavigatorProto, 'userAgentData', { get: uaDataGetter, configurable: true }); } catch(e) {}
      }
    } catch (e) {}
  }

  function buildWorkerPatchSource(tz, ua) {
    var spoofedLang = langMap[tz] || 'en-US';
    return '\
(function() {\n\
  "use strict";\n\
  var TARGET_TIMEZONE = ' + JSON.stringify(tz) + ';\n\
  var TARGET_UA = ' + JSON.stringify(ua || '') + ';\n\
  var SPOOFED_LANG = ' + JSON.stringify(spoofedLang) + ';\n\
  var SPOOFED_LANGS = Object.freeze([' + JSON.stringify(spoofedLang) + ', "en-US"]);\n\
\n\
  function makeNative(fn, name, length) {\n\
    length = length || 0;\n\
    var str = "function " + (name || fn.name || "") + "() { [native code] }";\n\
    Object.defineProperty(fn, "toString", { value: function() { return str; }, writable: true, configurable: true });\n\
    try {\n\
      Object.defineProperty(fn, "name", { value: name, configurable: true });\n\
      Object.defineProperty(fn, "length", { value: length, configurable: true });\n\
    } catch(e) {}\n\
    return fn;\n\
  }\n\
\n\
  try {\n\
    var OriginalDTF = self.Intl.DateTimeFormat;\n\
    var offsetFormatter = new OriginalDTF("en-US", { timeZone: TARGET_TIMEZONE, timeZoneName: "shortOffset", hour12: false });\n\
\n\
    function SpoofedDTF(locales, options) {\n\
      if (!(this instanceof SpoofedDTF)) return new SpoofedDTF(locales, options);\n\
      options = Object.assign({}, options || {});\n\
      if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;\n\
      return new OriginalDTF(locales, options);\n\
    }\n\
    SpoofedDTF.prototype = OriginalDTF.prototype;\n\
    SpoofedDTF.supportedLocalesOf = OriginalDTF.supportedLocalesOf;\n\
    makeNative(SpoofedDTF, "DateTimeFormat", 0);\n\
    self.Intl.DateTimeFormat = SpoofedDTF;\n\
\n\
    var origGetTimezoneOffset = self.Date.prototype.getTimezoneOffset;\n\
    var patchedGetOffset = function getTimezoneOffset() {\n\
      try {\n\
        var parts = offsetFormatter.formatToParts(this);\n\
        var tzPart = null;\n\
        for (var i = 0; i < parts.length; i++) {\n\
          if (parts[i].type === "timeZoneName") { tzPart = parts[i]; break; }\n\
        }\n\
        if (!tzPart || tzPart.value === "GMT" || tzPart.value === "UTC") return 0;\n\
        var match = tzPart.value.match(/GMT([+-])(\\d{1,2})(?::(\\d{2}))?/);\n\
        if (!match) return origGetTimezoneOffset.call(this);\n\
        var sign = match[1] === "+" ? -1 : 1;\n\
        var hours = parseInt(match[2], 10);\n\
        var minutes = match[3] ? parseInt(match[3], 10) : 0;\n\
        return sign * (hours * 60 + minutes);\n\
      } catch (e) {\n\
        return origGetTimezoneOffset.call(this);\n\
      }\n\
    };\n\
    self.Date.prototype.getTimezoneOffset = makeNative(patchedGetOffset, "getTimezoneOffset", 0);\n\
\n\
    if (TARGET_UA) {\n\
      var spoofedAppVersion = TARGET_UA.indexOf("Mozilla/") === 0 ? TARGET_UA.substring(8) : TARGET_UA;\n\
      var spoofedPlatform = "Win32";\n\
      if (TARGET_UA.indexOf("Macintosh") !== -1) spoofedPlatform = "MacIntel";\n\
      else if (TARGET_UA.indexOf("Android") !== -1) spoofedPlatform = "Linux armv8l";\n\
      else if (TARGET_UA.indexOf("Linux") !== -1) spoofedPlatform = "Linux x86_64";\n\
\n\
      var NavigatorProto = (self.WorkerNavigator && self.WorkerNavigator.prototype) || Object.getPrototypeOf(self.navigator) || self.navigator;\n\
      if (NavigatorProto) {\n\
        var props = {\n\
          userAgent: TARGET_UA,\n\
          appVersion: spoofedAppVersion,\n\
          platform: spoofedPlatform,\n\
          vendor: TARGET_UA.indexOf("Firefox") !== -1 ? "" : "Google Inc.",\n\
          language: SPOOFED_LANG,\n\
          languages: SPOOFED_LANGS\n\
        };\n\
\n\
        for (var prop in props) {\n\
          (function(p, v) {\n\
            var getter = makeNative(function() { return v; }, p, 0);\n\
            try { Object.defineProperty(NavigatorProto, p, { get: getter, configurable: true }); } catch(e) {}\n\
          })(prop, props[prop]);\n\
        }\n\
\n\
        if (TARGET_UA.indexOf("Chrome") !== -1 && self.navigator.userAgentData) {\n\
          var platform = TARGET_UA.indexOf("Windows") !== -1 ? "Windows" : (TARGET_UA.indexOf("Macintosh") !== -1 ? "macOS" : (TARGET_UA.indexOf("Android") !== -1 ? "Android" : "Linux"));\n\
          var majorVersion = (TARGET_UA.match(/Chrome\\/(\\d+)/) || [])[1] || "124";\n\
          var fullVersion = (TARGET_UA.match(/Chrome\\/([\\d.]+)/) || [])[1] || (majorVersion + ".0.0.0");\n\
          var isArm = TARGET_UA.indexOf("arm") !== -1 || TARGET_UA.indexOf("Android") !== -1;\n\
          var arch = isArm ? "arm" : "x86";\n\
          var bitness = isArm ? "" : "64";\n\
          var platformVersion = platform === "Windows" ? "15.0.0" : "14.0.0";\n\
          var isMobile = TARGET_UA.indexOf("Mobile") !== -1 || TARGET_UA.indexOf("Android") !== -1;\n\
          var brands = [\n\
            { brand: "Chromium", version: majorVersion },\n\
            { brand: "Google Chrome", version: majorVersion },\n\
            { brand: "Not-A.Brand", version: "99" }\n\
          ];\n\
\n\
          var uaDataGetter = makeNative(function() {\n\
            var obj = {\n\
              brands: brands,\n\
              mobile: isMobile,\n\
              platform: platform,\n\
              getHighEntropyValues: makeNative(async function(hints) {\n\
                hints = hints || [];\n\
                var result = { brands: brands, mobile: isMobile, platform: platform };\n\
                if (hints.indexOf("architecture") !== -1) result.architecture = arch;\n\
                if (hints.indexOf("bitness") !== -1) result.bitness = bitness;\n\
                if (hints.indexOf("model") !== -1) result.model = "";\n\
                if (hints.indexOf("platformVersion") !== -1) result.platformVersion = platformVersion;\n\
                if (hints.indexOf("uaFullVersion") !== -1) result.uaFullVersion = fullVersion;\n\
                if (hints.indexOf("fullVersionList") !== -1) {\n\
                  result.fullVersionList = [\n\
                    { brand: "Chromium", version: fullVersion },\n\
                    { brand: "Google Chrome", version: fullVersion },\n\
                    { brand: "Not-A.Brand", version: "99.0.0.0" }\n\
                  ];\n\
                }\n\
                return result;\n\
              }, "getHighEntropyValues", 1),\n\
              toJSON: makeNative(function() { return { brands: brands, mobile: isMobile, platform: platform }; }, "toJSON", 0)\n\
            };\n\
            Object.defineProperty(obj, Symbol.toStringTag, { value: "NavigatorUAData" });\n\
            return obj;\n\
          }, "userAgentData", 0);\n\
\n\
          try { Object.defineProperty(NavigatorProto, "userAgentData", { get: uaDataGetter, configurable: true }); } catch(e) {}\n\
        }\n\
      }\n\
    }\n\
  } catch (e) {}\n\
})();\n\
';
  }

  function patchServiceWorkerRegister(win) {
    try {
      var sw = win.navigator && win.navigator.serviceWorker;
      if (!sw || spoofedSWs.has(sw)) return;
      spoofedSWs.add(sw);

      var originalRegister = sw.register.bind(sw);

      var wrappedRegister = function(scriptURL, options) {
        try {
          var absoluteURL = new win.URL(scriptURL, win.location.href).href;
          win.document.documentElement.dispatchEvent(
            new win.CustomEvent('tz-guard-sw-register', { detail: absoluteURL })
          );
        } catch (e) {}
        return originalRegister(scriptURL, options);
      };

      makeNative(wrappedRegister, 'register', 1);
      Object.defineProperty(sw, 'register', {
        value: wrappedRegister,
        writable: true,
        configurable: true
      });
    } catch (e) {}
  }

  function patchWorkerConstructors(win) {
    ['Worker', 'SharedWorker'].forEach(function(ctorName) {
      var OriginalCtor = win[ctorName];
      if (!OriginalCtor || spoofedWorkers.has(OriginalCtor)) return;
      spoofedWorkers.add(OriginalCtor);

      var WrappedCtor = function(scriptURL, options) {
        try {
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
      makeNative(WrappedCtor, ctorName, 1);
      win[ctorName] = WrappedCtor;
    });
  }

  function spoofWindow(win) {
    try {
      if (!win || spoofedWindows.has(win)) return;
      spoofedWindows.add(win);

      var OriginalDTF = win.Intl.DateTimeFormat;
      rebuildFormatters(OriginalDTF);

      function SpoofedDTF(locales, options) {
        options = options || {};
        if (!(this instanceof SpoofedDTF)) {
          return new SpoofedDTF(locales, options);
        }
        var opts = Object.assign({}, options);
        if (!opts.timeZone) opts.timeZone = TARGET_TIMEZONE;
        var instance = new OriginalDTF(locales, opts);
        Object.setPrototypeOf(instance, SpoofedDTF.prototype);
        return instance;
      }

      SpoofedDTF.prototype = Object.create(OriginalDTF.prototype);
      SpoofedDTF.prototype.constructor = SpoofedDTF;
      SpoofedDTF.supportedLocalesOf = OriginalDTF.supportedLocalesOf;
      makeNative(SpoofedDTF, 'DateTimeFormat', 0);
      win.Intl.DateTimeFormat = SpoofedDTF;

      var origGetTimezoneOffset = win.Date.prototype.getTimezoneOffset;

      var patchedGetOffset = function getTimezoneOffset() {
        try {
          var parts = offsetFormatter.formatToParts(this);
          var tzPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
          if (!tzPart || tzPart.value === 'GMT' || tzPart.value === 'UTC') return 0;
          var match = tzPart.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
          if (!match) return origGetTimezoneOffset.call(this);
          var sign = match[1] === '+' ? -1 : 1;
          var hours = parseInt(match[2], 10);
          var minutes = match[3] ? parseInt(match[3], 10) : 0;
          return sign * (hours * 60 + minutes);
        } catch (e) {
          return origGetTimezoneOffset.call(this);
        }
      };

      win.Date.prototype.getTimezoneOffset = makeNative(patchedGetOffset, 'getTimezoneOffset', 0);

      var methods = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];

      methods.forEach(function(methodName) {
        var original = win.Date.prototype[methodName];

        var patchedMethod = function() {
          var args = Array.from(arguments);
          try {
            if (methodName.indexOf('toLocale') === 0) {
              var locales = args[0];
              var options = args[1];
              options = Object.assign({}, options);
              if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
              return original.call(this, locales, options);
            }

            var parts = stringFormatter.formatToParts(this);
            var map = {};
            parts.forEach(function(p) { map[p.type] = p.value; });

            var offsetMin = this.getTimezoneOffset();
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
          } catch (e) {
            return original.apply(this, args);
          }
        };

        win.Date.prototype[methodName] = makeNative(patchedMethod, methodName, 0);
      });

      spoofUserAgent(win);
      patchWorkerConstructors(win);
      patchServiceWorkerRegister(win);
      patchIframeGetters(win);

    } catch (e) {}
  }

  var patchedIframeProtos = new WeakSet();

  function patchIframeGetters(win) {
    try {
      var IFrameProto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
      if (!IFrameProto || patchedIframeProtos.has(IFrameProto)) return;
      patchedIframeProtos.add(IFrameProto);

      var cwDescriptor = Object.getOwnPropertyDescriptor(IFrameProto, 'contentWindow');
      if (cwDescriptor && cwDescriptor.get) {
        var originalContentWindowGetter = cwDescriptor.get;
        Object.defineProperty(IFrameProto, 'contentWindow', {
          get: makeNative(function() {
            var w = originalContentWindowGetter.call(this);
            if (w) {
              try { spoofWindow(w); } catch (e) {}
            }
            return w;
          }, 'get contentWindow', 0),
          configurable: true
        });
      }

      var cdDescriptor = Object.getOwnPropertyDescriptor(IFrameProto, 'contentDocument');
      if (cdDescriptor && cdDescriptor.get) {
        var originalContentDocumentGetter = cdDescriptor.get;
        Object.defineProperty(IFrameProto, 'contentDocument', {
          get: makeNative(function() {
            var doc = originalContentDocumentGetter.call(this);
            if (doc && doc.defaultView) {
              try { spoofWindow(doc.defaultView); } catch (e) {}
            }
            return doc;
          }, 'get contentDocument', 0),
          configurable: true
        });
      }
    } catch (e) {}
  }

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

  if (document.documentElement) {
    scanForIframes(document.documentElement);
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      for (var j = 0; j < mutation.addedNodes.length; j++) {
        scanForIframes(mutation.addedNodes[j]);
      }
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();