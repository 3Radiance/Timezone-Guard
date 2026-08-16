const tzSelect = document.getElementById('tzSelect');
const uaPresetSelect = document.getElementById('uaPresetSelect');
const uaInput = document.getElementById('uaInput');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');


uaPresetSelect.addEventListener('change', () => {
  uaInput.value = uaPresetSelect.value;
});

(async function init() {
  const { tz, ua } = await browser.storage.local.get(['tz', 'ua']);
  if (tz) tzSelect.value = tz;
  if (ua) uaInput.value = ua;
})();

btn.addEventListener('click', async () => {
  const tz = tzSelect.value;
  const ua = uaInput.value.trim(); 
  await browser.storage.local.set({ tz, ua });
  status.textContent = 'Saved! Reload the tab.';
  setTimeout(() => { status.textContent = ''; }, 3000);
});