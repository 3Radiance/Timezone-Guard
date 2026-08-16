# Privacy Policy — Timezone Guard

*[Читать на русском](ru/PRIVACY.ru.md)*

**Last updated:** August 2026

Timezone Guard does not collect, store, or transmit any personal data.

## What data is stored

The extension stores two pieces of information locally on your device using the browser's `storage.local` API:

1. **Timezone** — the time zone you select in the popup (e.g. `Europe/Helsinki`).
2. **User-Agent** *(optional)* — the browser identifier you optionally choose to spoof.

- This data never leaves your browser.
- It is not sent to any server, third party, or the extension developer.
- It is only used to determine which values are reported to websites.

## What the extension does on web pages

Timezone Guard injects a small script into each page you visit to override time zone and (optionally) User-Agent values returned by JavaScript APIs. This script:

- Runs entirely within your browser.
- Applies to the main page, iframes, Dedicated Workers, Shared Workers, and Service Workers.
- Does not read, collect, or transmit any content from the pages you visit.
- Does not communicate with any external server.

For Service Workers specifically, the extension temporarily modifies the network response of the Service Worker script to inject the spoofing code. This only affects URLs registered as Service Workers on the sites you visit and does not alter any other network traffic.

## Permissions

- `storage` — to save your selected time zone and User-Agent locally.
- `<all_urls>` (host permission) — required so the override can be applied on every website you visit, before the page's own scripts run.
- `webRequest`, `webRequestBlocking`, `webRequestFilterResponse`, `webRequestFilterResponse.serviceWorkerScript` — required exclusively to patch Service Worker scripts via network response interception.

## Contact

If you have questions about this policy, please open an issue on the project's GitHub repository.
