export async function openFullDashboard(hash = ''): Promise<void> {
  const baseUrl = chrome.runtime.getURL('index.html');
  const targetUrl = hash ? `${baseUrl}${hash}` : baseUrl;
  const matchPattern = chrome.runtime.getURL('index.html*');

  try {
    const tabs = await chrome.tabs.query({ url: matchPattern });
    const existing = tabs[0];
    if (existing?.id != null) {
      await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: targetUrl } : {}) });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  } catch (error) {
    console.warn('openFullDashboard: failed to focus existing tab', error);
  }

  chrome.tabs.create({ url: targetUrl });
}
