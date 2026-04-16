export async function openFullDashboard(hash = ''): Promise<void> {
  const baseUrl = chrome.runtime.getURL('index.html');
  const targetUrl = hash ? `${baseUrl}${hash}` : baseUrl;
  const matchPattern = chrome.runtime.getURL('index.html*');

  try {
    const tabs = await chrome.tabs.query({ url: matchPattern });
    const existing = tabs[0];
    if (existing?.id != null) {
      const existingHash = existing.url ? new URL(existing.url).hash : '';
      const shouldNavigate = hash && !existingHash;
      await chrome.tabs.update(existing.id, { active: true, ...(shouldNavigate ? { url: targetUrl } : {}) });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  } catch (error) {
    console.warn('openFullDashboard: failed to focus existing tab', error);
  }

  await chrome.tabs.create({ url: targetUrl });
}
