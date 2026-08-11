// Cross-device signing bridge — WebSocket transport adapter.
//
// Implements the `Transport` interface (see crossDeviceSigning.service.ts) over
// the existing raw WebSocket in websocket.service.ts. It is only wired when the
// isCrossDeviceSigningEnabled flag is on (see walletManager.service.ts); when
// the flag is off nothing here runs and no relay message ever crosses the wire.
//
// Outbound: publishes via webSocketService.sendRaw (thin passthrough over the
// existing private send; obeys the same OPEN-socket guard).
// Inbound: websocket.service forwards cross-device message types to
// onCrossDeviceMessage, which calls feedCrossDeviceMessage here, fanning the raw
// message out to every registered listener.

import webSocketService from '@/services/websocket.service';
import type { CrossDeviceMessage } from './protocol';
import type { Transport } from './crossDeviceSigning.service';
import type { ProveMessage } from './proveProtocol';
import type { ProveTransport } from './proveService';

// Module-level inbound listeners. The service's Transport.onMessage registers
// here; websocket.service feeds inbound messages via feedCrossDeviceMessage.
const inboundListeners = new Set<(raw: unknown) => void>();

/**
 * Feed an inbound cross-device relay message to all registered listeners.
 * Called from the walletManager `onCrossDeviceMessage` handler, which
 * websocket.service invokes when it receives a cross-device message type.
 */
export function feedCrossDeviceMessage(raw: unknown): void {
  for (const listener of [...inboundListeners]) {
    listener(raw);
  }
}

function subscribe(cb: (raw: unknown) => void): () => void {
  inboundListeners.add(cb);
  return () => inboundListeners.delete(cb);
}

/**
 * Build a Transport backed by the shared webSocketService singleton.
 */
export function createWsTransport(): Transport {
  return {
    send(msg: CrossDeviceMessage): void {
      webSocketService.sendRaw(msg);
    },
    onMessage: subscribe,
  };
}

/**
 * The same socket and the same inbound fan-out, typed for XDP's frames.
 *
 * A separate factory rather than widening `Transport` to a union: the signing
 * service must not be able to emit a proving frame (or vice versa) by a type
 * slip, and the two protocols version independently. Both services receive
 * EVERY inbound frame and ignore what isn't theirs — the parsers are disjoint,
 * so this costs one failed type guard per frame.
 */
export function createProveWsTransport(): ProveTransport {
  return {
    send(msg: ProveMessage): void {
      webSocketService.sendRaw(msg);
    },
    onMessage: subscribe,
  };
}
