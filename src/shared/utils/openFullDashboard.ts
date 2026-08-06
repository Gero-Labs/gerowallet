/**
 * @param hash          Target route, e.g. '#/governance'.
 * @param forceNavigate Send an already-open dashboard tab to `hash` even when it
 *                      is sitting on another route. Off by default so the generic
 *                      "open the dashboard" button never yanks a tab the user is
 *                      working in; on for hand-offs where the whole point of the
 *                      click is to land on that route (side-panel → sign here).
 */
export async function openFullDashboard(hash = '', forceNavigate = false): Promise<void> {
  const baseUrl = chrome.runtime.getURL('index.html');
  const targetUrl = hash ? `${baseUrl}${hash}` : baseUrl;
  const matchPattern = chrome.runtime.getURL('index.html*');

  try {
    const tabs = await chrome.tabs.query({ url: matchPattern });
    const existing = tabs[0];
    if (existing?.id != null) {
      const existingHash = existing.url ? new URL(existing.url).hash : '';
      const shouldNavigate = !!hash && (forceNavigate ? existingHash !== hash : !existingHash);
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
