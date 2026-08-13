# Privacy Policy — Timezone Guard

**Last updated:** August 2026

Timezone Guard does not collect, store, or transmit any personal data.

## What data is stored

The only piece of information the extension stores is the timezone you select in the popup (e.g. `Europe/Helsinki`). This is saved locally on your device using the browser's `storage.local` API.

- This data never leaves your browser.
- It is not sent to any server, third party, or the extension developer.
- It is only used to determine which timezone value is reported to websites.

## What the extension does on web pages

Timezone Guard injects a small script into each page you visit to override the timezone-related values returned by `Intl.DateTimeFormat` and `Date` methods. This script:

- Runs entirely within your browser.
- Does not read, collect, or transmit any content from the pages you visit.
- Does not communicate with any external server.

## Permissions

- `storage` — to save your selected timezone locally.
- `<all_urls>` (host permission) — required so the timezone override can be applied on every website you visit, before the page's own scripts run.

## Contact

If you have questions about this policy, please open an issue on the project's GitHub repository.
