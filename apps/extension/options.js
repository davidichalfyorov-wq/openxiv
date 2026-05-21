chrome.storage.local.get(['apiBase'], (r) => {
  if (r.apiBase) document.getElementById('apiBase').value = r.apiBase;
});

document.getElementById('save').addEventListener('click', () => {
  const apiBase = document.getElementById('apiBase').value.trim();
  chrome.storage.local.set({ apiBase }, () => {
    document.getElementById('status').textContent = 'Saved.';
    setTimeout(() => {
      document.getElementById('status').textContent = '';
    }, 1500);
  });
});
