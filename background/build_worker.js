export function buildWorkerPatchSource(tz, ua) {
  const langMap = {
    'Europe/Helsinki': 'fi-FI', 'Europe/Moscow': 'ru-RU', 'Europe/London': 'en-GB',
    'Europe/Berlin': 'de-DE', 'Europe/Kyiv': 'uk-UA', 'America/New_York': 'en-US',
    'America/Los_Angeles': 'en-US', 'Asia/Dubai': 'ar-AE', 'Asia/Tokyo': 'ja-JP'
  };
  const spoofedLang = langMap[tz] || 'en-US';
  
  return `
(function() {
  'use strict';
  var TARGET_TIMEZONE = ${JSON.stringify(tz)};
  var TARGET_UA = ${JSON.stringify(ua || '')};
  var SPOOFED_LANG = ${JSON.stringify(spoofedLang)};
  var SPOOFED_LANGS = Object.freeze([${JSON.stringify(spoofedLang)}, "en-US"]);

  function makeNative(fn, name, length) {
    length = length || 0;
    var str = 'function ' + (name || fn.name || '') + '() { [native code] }';
    Object.defineProperty(fn, 'toString', { value: function() { return str; }, writable: true, configurable: true });
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      Object.defineProperty(fn, 'length', { value: length, configurable: true });
    } catch(e) {}
    return fn;
  }

  try {
    var OriginalDTF = self.Intl.DateTimeFormat;
    var offsetFormatter = new OriginalDTF('en-US', { timeZone: TARGET_TIMEZONE, timeZoneName: 'shortOffset', hour12: false });

    function SpoofedDTF(locales, options) {
      if (!(this instanceof SpoofedDTF)) return new SpoofedDTF(locales, options);
      options = Object.assign({}, options || {});
      if (!options.timeZone) options.timeZone = TARGET_TIMEZONE;
      return new OriginalDTF(locales, options);
    }
    SpoofedDTF.prototype = OriginalDTF.prototype;
    SpoofedDTF.supportedLocalesOf = OriginalDTF.supportedLocalesOf;
    makeNative(SpoofedDTF, 'DateTimeFormat', 0);
    self.Intl.DateTimeFormat = SpoofedDTF;

    var origGetTimezoneOffset = self.Date.prototype.getTimezoneOffset;
    var patchedGetOffset = function getTimezoneOffset() {
      try {
        var parts = offsetFormatter.formatToParts(this);
        var tzPart = null;
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === 'timeZoneName') { tzPart = parts[i]; break; }
        }
        if (!tzPart || tzPart.value === 'GMT' || tzPart.value === 'UTC') return 0;
        var match = tzPart.value.match(/GMT([+-])(\\d{1,2})(?::(\\d{2}))?/);
        if (!match) return origGetTimezoneOffset.call(this);
        var sign = match[1] === '+' ? -1 : 1;
        var hours = parseInt(match[2], 10);
        var minutes = match[3] ? parseInt(match[3], 10) : 0;
        return sign * (hours * 60 + minutes);
      } catch (e) {
        return origGetTimezoneOffset.call(this);
      }
    };
    self.Date.prototype.getTimezoneOffset = makeNative(patchedGetOffset, 'getTimezoneOffset', 0);
    
    if (TARGET_UA) {
      var spoofedAppVersion = TARGET_UA.indexOf('Mozilla/') === 0 ? TARGET_UA.substring(8) : TARGET_UA;
      var spoofedPlatform = 'Win32';
      if (TARGET_UA.indexOf('Macintosh') !== -1) spoofedPlatform = 'MacIntel';
      else if (TARGET_UA.indexOf('Android') !== -1) spoofedPlatform = 'Linux armv8l';
      else if (TARGET_UA.indexOf('Linux') !== -1) spoofedPlatform = 'Linux x86_64';
      
      var NavigatorProto = (self.WorkerNavigator && self.WorkerNavigator.prototype) || Object.getPrototypeOf(self.navigator) || self.navigator;
      if (NavigatorProto) {
        var props = { 
          userAgent: TARGET_UA, 
          appVersion: spoofedAppVersion, 
          platform: spoofedPlatform, 
          vendor: TARGET_UA.indexOf('Firefox') !== -1 ? '' : 'Google Inc.',
          language: SPOOFED_LANG,
          languages: SPOOFED_LANGS
        };
        
        for (var prop in props) {
          (function(p, v) {
            var getter = makeNative(function() { return v; }, p, 0);
            try { Object.defineProperty(NavigatorProto, p, { get: getter, configurable: true }); } catch(e) {}
          })(prop, props[prop]);
        }

        if (TARGET_UA.indexOf('Chrome') !== -1 && self.navigator.userAgentData) {
          var platform = TARGET_UA.indexOf('Windows') !== -1 ? 'Windows' : (TARGET_UA.indexOf('Macintosh') !== -1 ? 'macOS' : (TARGET_UA.indexOf('Android') !== -1 ? 'Android' : 'Linux'));
          var majorVersion = (TARGET_UA.match(/Chrome\\/(\\d+)/) || [])[1] || '124';
          var fullVersion = (TARGET_UA.match(/Chrome\\/([\\d.]+)/) || [])[1] || (majorVersion + '.0.0.0');
          var isArm = TARGET_UA.indexOf('arm') !== -1 || TARGET_UA.indexOf('Android') !== -1;
          var arch = isArm ? 'arm' : 'x86';
          var bitness = isArm ? '' : '64';
          var platformVersion = platform === 'Windows' ? '15.0.0' : '14.0.0';
          var isMobile = TARGET_UA.indexOf('Mobile') !== -1 || TARGET_UA.indexOf('Android') !== -1;
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
      }
    }
  } catch (e) {}
})();
`;
}