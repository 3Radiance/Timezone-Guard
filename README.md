# Timezone Guard

*[Читать на русском](README.ru.md)*

A lightweight Firefox extension that overrides the timezone your browser reports to websites, protecting you from timezone-based fingerprinting.

## Why

Many websites detect your timezone via JavaScript APIs (`Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, etc.) to infer your approximate location — even when you're using a VPN. Timezone Guard intercepts these APIs and reports a timezone of your choosing instead, keeping all patched values internally consistent (the offset, the formatted date/time strings, and `Intl.DateTimeFormat().resolvedOptions().timeZone` all agree with each other).

This works similarly in spirit to Firefox's built-in `privacy.resistFingerprinting` setting, but lets you pick the timezone yourself rather than always falling back to a fixed one.

## Features

- Choose from a list of common timezones via the popup
- Patches `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, and `Date.prototype.toString` / `toDateString` / `toTimeString` / `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`
- Applies to the top-level page and all embedded iframes, including ones added dynamically after page load
- Runs entirely locally — no data is collected or transmitted anywhere
- The real system clock and `Date.now()` timestamp are left untouched; only how dates are *interpreted and displayed* in the selected timezone is changed, so pages that depend on real elapsed time keep working correctly
- Tested to work correctly on YouTube — playback, live streams, and comment timestamps are not broken
- Compatible with Firefox's built-in `privacy.resistFingerprinting`; you can run both at once without conflicts
- Works on sites with a strict Content-Security-Policy (e.g. Spotify Web Player) — the spoofing script is injected directly into the page's main world by the browser itself, not via a DOM-inserted `<script>` tag, so it isn't subject to the page's CSP `script-src` rules

## How it works

Websites with a strict Content-Security-Policy block inline scripts inserted via `document.createElement('script')`, which is how many timezone-spoofing extensions (including earlier versions of this one) inject their patch. To work reliably everywhere, Timezone Guard splits the job across two content scripts:

1. **`bridge.js`** runs in the *isolated world* at `document_start`. It has access to `browser.storage.local`, reads your saved timezone preference, and writes it into a `data-tz-guard` attribute on `<html>` (falling back to a default immediately, so nothing has to wait on the async storage read).
2. **`spoof.js`** runs in the page's *main world* at `document_start`, declared directly in the manifest with `"world": "MAIN"`. Because the browser injects it itself rather than the page inserting it via the DOM, it bypasses the page's CSP entirely. It reads the timezone value bridge.js wrote to the DOM attribute and patches the relevant `Intl`/`Date` methods on `window` — and on every iframe's `window`, tracked via a `MutationObserver`.

## Installation (development / unpacked)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on**.
3. Select the `manifest.json` file in this repo.
4. Open the extension's popup, pick a timezone, click **Apply**, then reload any open tabs.

## Project structure

```
manifest.json
bridge.js          — isolated-world script: reads storage, passes the timezone to the page via a DOM attribute
spoof.js            — main-world script: patches Intl/Date, bypasses page CSP
popup.html          — popup UI
popup.js            — reads/writes the selected timezone to storage
icons/              — extension icons (16/32/48/128 px)
```

## Limitations

- After changing the timezone in the popup, open tabs need to be reloaded — the spoof is applied once per page load, not live.
- This only affects the *reported* timezone in JavaScript APIs. It does not change your operating system's clock or timezone.
- Some fingerprinting scripts may cross-check other signals (e.g. `Intl.NumberFormat`, keyboard layout, `navigator.language`) that this extension does not currently spoof.
- Declarative `"world": "MAIN"` content scripts require a reasonably recent Firefox/Chromium version.

## License

MIT