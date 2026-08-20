const tzSelect = document.getElementById('tzSelect');
const uaPresetSelect = document.getElementById('uaPresetSelect');
const uaInput = document.getElementById('uaInput');
const enabledToggle = document.getElementById('enabledToggle');
const spoofHeadersToggle = document.getElementById('spoofHeadersToggle');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');


uaPresetSelect.addEventListener('change', () => {
  uaInput.value = uaPresetSelect.value;
});

(async function init() {
  try {
    const { tz, ua, enabled, spoofHeaders } = await browser.storage.local.get(['tz', 'ua', 'enabled', 'spoofHeaders']);
    if (tz) tzSelect.value = tz;
    if (ua) uaInput.value = ua;
    if (enabled !== undefined) enabledToggle.checked = enabled;
    if (spoofHeaders !== undefined) spoofHeadersToggle.checked = spoofHeaders;
  } catch (e) {
    status.textContent = 'Error loading settings';
    status.style.color = '#f38ba8';
  }
})();

btn.addEventListener('click', async () => {
  try {
    const tz = tzSelect.value;
    const ua = uaInput.value.trim();
    const enabled = enabledToggle.checked;
    const spoofHeaders = spoofHeadersToggle.checked;
    await browser.storage.local.set({ tz, ua, enabled, spoofHeaders });
    status.textContent = 'Saved! Reload the tab.';
    status.style.color = '#a6e3a1';
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (e) {
    status.textContent = 'Error saving settings';
    status.style.color = '#f38ba8';
  }
});