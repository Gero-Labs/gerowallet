import { reactive } from 'vue';

export const snapshot = reactive<PilotSnapshot>({ revision: -1, locked: true, wallet: '', network: '', approvals: 0 });
// Read-only from the browser test: counts real pending application handlers, without
// changing validation/authorization results or injecting worker state.
export const diagnostics = reactive({ inFlight: 0 });
function accept(state?: PilotSnapshot) {
  if (state && state.revision >= snapshot.revision) Object.assign(snapshot, state);
}
chrome.runtime.onMessage.addListener((message: PilotMessage) => {
  if (message.namespace === 'gero-migration-pilot' && message.type === 'changed') accept(message.state);
});
export async function request(type: string, extra: Partial<PilotMessage> = {}) {
  const response: PilotResponse = await chrome.runtime.sendMessage({ ...extra, namespace: 'gero-migration-pilot', type });
  accept(response.state);
  if (!response.ok) throw new Error(response.reason || 'Worker rejected the pilot request');
  return response;
}
export const hydration = request('snapshot');
