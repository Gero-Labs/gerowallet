// Synthetic state only. Deliberately separate from GeroWallet's messaging/storage protocols.
const initial = { revision: 0, locked: true, wallet: 'pilot-a', network: 'preview', approvals: 0 };
let operations = Promise.resolve();
const read = async () => (await chrome.storage.local.get('pilotSnapshot')).pilotSnapshot ?? initial;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.namespace !== 'gero-migration-pilot') return false;
  operations = operations.then(async () => {
    const state = await read();
    if (message.type === 'snapshot') return { ok: true, state };
    const next = { ...state, revision: state.revision + 1 };
    if (message.type === 'lock') next.locked = true;
    else if (message.type === 'unlock') next.locked = false;
    else if (message.type === 'wallet') next.wallet = state.wallet === 'pilot-a' ? 'pilot-b' : 'pilot-a';
    else if (message.type === 'network') next.network = state.network === 'preview' ? 'preprod' : 'preview';
    else if (message.type === 'approve') {
      if (state.locked || message.revision !== state.revision || !Number.isFinite(message.amount) || message.amount <= 0 || message.amount > 10) {
        return { ok: false, reason: 'stale-or-invalid', state };
      }
      next.approvals += 1;
    } else return { ok: false, reason: 'unknown-message', state };
    await chrome.storage.local.set({ pilotSnapshot: next });
    // Runtime messaging reaches both open extension documents. No fixture overrides.
    await chrome.runtime.sendMessage({ namespace: 'gero-migration-pilot', type: 'changed', state: next }).catch(() => undefined);
    return { ok: true, state: next };
  });
  operations.then(respond, (error) => respond({ ok: false, reason: String(error) }));
  operations = operations.catch(() => undefined);
  return true;
});
