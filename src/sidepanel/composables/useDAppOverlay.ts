import { hub, DAppRequest } from '../services/dappRequestHub';

export type { DAppRequest };

// Thin adapter kept for backward compatibility: the port now lives in the
// panel-lifetime dappRequestHub (initialized once from App.vue), so locking,
// logging out, or unmounting DAppOverlay no longer disconnects the port or
// rejects requests — they park and re-deliver instead. The hub also owns the
// Apex popup-fallback exclusion internally (see dappRequestHub.ts), so this
// adapter no longer needs its own useChainContext()/isApex gate.
export function useDAppOverlay() {
  return {
    isVisible: hub.isVisible,
    currentRequest: hub.currentRequest,
    requestQueue: hub.requestQueue,
    connectionLost: hub.connectionLost,
    approve: hub.approve,
    reject: hub.reject,
    rejectQueued: hub.rejectQueued,
    rejectAll: hub.rejectAll,
  };
}
