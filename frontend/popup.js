const tzSelect = document.getElementById('tzSelect');
const uaPresetSelect = document.getElementById('uaPresetSelect');
const uaInput = document.getElementById('uaInput');
const enabledToggle = document.getElementById('enabledToggle');
const spoofHeadersToggle = document.getElementById('spoofHeadersToggle');
const whitelistInput = document.getElementById('whitelistInput');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');


uaPresetSelect.addEventListener('change', () => {
  uaInput.value = uaPresetSelect.value;
});

(async function init() {
  try {
    const { tz, ua, enabled, spoofHeaders, whitelist } = await browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders', 'whitelist']);
    if (tz) tzSelect.value = tz;
    if (ua) uaInput.value = ua;
    if (enabled !== undefined) enabledToggle.checked = enabled;
    if (spoofHeaders !== undefined) spoofHeadersToggle.checked = spoofHeaders;
    if (Array.isArray(whitelist)) whitelistInput.value = whitelist.join('\n');
  } catch (e) {
    status.textContent = 'Error loading settings';
    status.style.color = '#f38ba8';
  }
})();

function parseWhitelist(raw) {
  const seen = new Set();
  const list = [];
  for (const line of String(raw || '').split('\n')) {
    let entry = line.trim().toLowerCase();
    // strip scheme / path / port if user pasted a full URL
    entry = entry.replace(/^https?:\/\//, '').split(/[/:?#]/)[0].replace(/^\*\.?/, '');
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    list.push(entry);
  }
  return list;
}

btn.addEventListener('click', async () => {
  try {
    const tz = tzSelect.value;
    const ua = uaInput.value.trim();
    const enabled = enabledToggle.checked;
    const spoofHeaders = spoofHeadersToggle.checked;
    const whitelist = parseWhitelist(whitelistInput.value);
    await browser.storage.local.set({ tz, ua, enabled, spoofHeaders, whitelist });
    status.textContent = 'Saved! Reload the tab.';
    status.style.color = '#a6e3a1';
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (e) {
    status.textContent = 'Error saving settings';
    status.style.color = '#f38ba8';
  }
});