/**
 * Opens a transaction's flow diagram (`#/tx-flow/<id>`, TxFlowWindow.vue) in a
 * popup window wide enough for it. One window at a time: an open one is pointed
 * at the new transaction and focused.
 */
const WIDTH = 900;
const HEIGHT = 680;

export async function openTxFlowWindow(txId: string): Promise<void> {
  // A Cardano transaction id is 32 bytes of hex; nothing else goes into the URL
  if (!/^[0-9a-f]{64}$/i.test(txId)) return;
  const base = chrome.runtime.getURL('index.html#/tx-flow/');
  const url = `${base}${txId.toLowerCase()}`;

  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const win of windows) {
      const tab = win.tabs?.find((candidate) => candidate.url?.startsWith(base));
      if (win.id != null && tab?.id != null) {
        await chrome.tabs.update(tab.id, { url });
        await chrome.windows.update(win.id, { focused: true });
        return;
      }
    }
  } catch {
    // Fall through to a new window
  }
  await chrome.windows.create({ url, type: 'popup', focused: true, width: WIDTH, height: HEIGHT });
}
