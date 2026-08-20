# Privacy Policy — Timezone Guard

*[Читать на русском](ru/PRIVACY.ru.md)*

**Last updated:** August 2026

Timezone Guard does not collect, store, or transmit any personal data to external servers.

## What data is stored locally

The extension stores the following information locally on your device using the browser's `storage.local` API:

1. **Timezone** — the time zone you select in the popup (e.g., `Europe/Helsinki`).
2. **User-Agent** *(optional)* — the browser identifier you optionally choose to spoof.
3. **Extension state** — whether the extension is enabled (`enabled`) and whether HTTP header spoofing is active (`spoofHeaders`).
4. **Service Worker URLs** — URLs of registered Service Workers on sites you visit, used to re-apply patches after browser restarts.

- This data never leaves your browser.
- It is not sent to any server, third party, or the extension developer.
- It is only used to determine which values are reported to websites.

## Temporary data in page context

To transfer settings between the extension's isolated world and the page's main world, the extension uses:

- **DOM attributes** on the `<html>` element (read immediately at `document_start` and removed).
- **`sessionStorage` and `localStorage`** keys (`__tzGuardConfig`) — used as a fallback to survive page reloads and bfcache restores.

This data is written to the page's own storage and is never transmitted externally.

## What the extension does on web pages

Timezone Guard injects a small script into each page you visit to override time zone and (optionally) User-Agent values returned by JavaScript APIs. This script:

- Runs entirely within your browser.
- Applies to the main page, iframes, Dedicated Workers, Shared Workers, and Service Workers.
- Does not read, collect, or transmit any content from the pages you visit.
- Does not communicate with any external server.

For Service Workers specifically, the extension temporarily modifies the network response of the Service Worker script to inject the spoofing code. This only affects URLs registered as Service Workers on the sites you visit and does not alter any other network traffic.

## HTTP headers

When **"Spoof HTTP Headers"** is enabled, the extension modifies outgoing HTTP request headers (`Accept-Language` and optionally `User-Agent`) to match your selected timezone and browser identifier. This modification happens locally in your browser before the request is sent.

## Permissions

- `storage` — to save your selected settings and known Service Worker URLs locally.
- `<all_urls>` (host permission) — required so the override can be applied on every website you visit, before the page's own scripts run.
- `webRequest`, `webRequestBlocking`, `webRequestFilterResponse`, `webRequestFilterResponse.serviceWorkerScript` — required exclusively to patch Service Worker scripts via network response interception and to modify HTTP request headers.

## Contact

If you have questions about this policy, please open an issue on the project's GitHub repository.
