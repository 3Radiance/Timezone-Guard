const select = document.getElementById('tzSelect');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');

(async function init() {
  const { tz } = await browser.storage.local.get('tz');
  if (tz) select.value = tz;
})();

btn.addEventListener('click', async () => {
  const tz = select.value;
  await browser.storage.local.set({ tz });
  status.textContent = 'Reload the tab.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});