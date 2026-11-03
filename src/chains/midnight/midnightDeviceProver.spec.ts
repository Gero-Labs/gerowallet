import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptMidnightProverPort,
  DeviceProvingError,
  makeDeviceProvingProvider,
  resetDeviceProverForTests,
} from './midnightDeviceProver';
import {
  base64ToBytes,
  bytesToBase64,
  decodeCheckResult,
  encodeCheckResult,
  MIDNIGHT_PROVER_DOCUMENT,
  MIDNIGHT_PROVER_PORT,
  type MidnightProverReply,
  type MidnightProverRequest,
} from './midnightDeviceProverProtocol';
import { walletProverFor } from './midnightProvingTarget';

const EXTENSION_ID = 'gero-test-extension';
const DOCUMENT_URL = `chrome-extension://${EXTENSION_ID}/${MIDNIGHT_PROVER_DOCUMENT}`;

/** A fake runtime port: records what the background posts, lets the test reply. */
function fakePort(sender: Partial<chrome.runtime.MessageSender>, name = MIDNIGHT_PROVER_PORT) {
  const messageListeners: Array<(message: MidnightProverReply) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: MidnightProverRequest[] = [];
  const port = {
    name,
    sender,
    postMessage: vi.fn((message: MidnightProverRequest) => { posted.push(message); }),
    disconnect: vi.fn(() => disconnectListeners.forEach((l) => l())),
    onMessage: { addListener: (l: (message: MidnightProverReply) => void) => messageListeners.push(l) },
    onDisconnect: { addListener: (l: () => void) => disconnectListeners.push(l) },
  } as unknown as chrome.runtime.Port & { postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  return {
    port,
    posted,
    reply: (message: MidnightProverReply) => messageListeners.forEach((l) => l(message)),
    drop: () => disconnectListeners.forEach((l) => l()),
  };
}

const ownSender = { id: EXTENSION_ID, url: DOCUMENT_URL };

describe('midnightDeviceProverProtocol', () => {
  it('round-trips bytes through base64, including large buffers', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('carries check results (bigints and gaps) through JSON', () => {
    const result = [1n, undefined, 2n ** 200n];
    expect(decodeCheckResult(JSON.parse(JSON.stringify(encodeCheckResult(result))))).toEqual(result);
  });
});

describe('midnightDeviceProver', () => {
  let createDocument: ReturnType<typeof vi.fn>;
  let closeDocument: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDeviceProverForTests();
    createDocument = vi.fn().mockResolvedValue(undefined);
    closeDocument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      runtime: {
        id: EXTENSION_ID,
        getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
        getContexts: vi.fn().mockResolvedValue([]),
      },
      offscreen: { createDocument, closeDocument, Reason: { WORKERS: 'WORKERS' } },
    });
  });

  afterEach(() => {
    resetDeviceProverForTests();
    vi.unstubAllGlobals();
  });

  it('accepts only its own offscreen document, never a content script or another page', () => {
    const fromContentScript = fakePort({ id: EXTENSION_ID, url: DOCUMENT_URL, tab: { id: 1 } as chrome.tabs.Tab });
    expect(acceptMidnightProverPort(fromContentScript.port)).toBe(true);
    expect(fromContentScript.port.disconnect).toHaveBeenCalled();

    const fromOtherPage = fakePort({ id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/sidepanel/index.html` });
    acceptMidnightProverPort(fromOtherPage.port);
    expect(fromOtherPage.port.disconnect).toHaveBeenCalled();

    const fromOtherExtension = fakePort({ id: 'someone-else', url: DOCUMENT_URL });
    acceptMidnightProverPort(fromOtherExtension.port);
    expect(fromOtherExtension.port.disconnect).toHaveBeenCalled();

    const unrelated = fakePort(ownSender, 'mini-gero-dapp-channel:3');
    expect(acceptMidnightProverPort(unrelated.port)).toBe(false);
    expect(unrelated.port.disconnect).not.toHaveBeenCalled();
  });

  it('refuses a Zswap or contract circuit for a fee-only provider before sending any preimage', async () => {
    const provider = makeDeviceProvingProvider({ shielded: false });
    await expect(provider.prove(new Uint8Array([1]), 'midnight/zswap/spend')).rejects.toBeInstanceOf(DeviceProvingError);
    await expect(provider.check(new Uint8Array([1]), 'my-contract/transfer')).rejects.toBeInstanceOf(DeviceProvingError);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('opens the offscreen document, proves over the port and returns the proof', async () => {
    const remote = fakePort(ownSender);
    createDocument.mockImplementation(async () => { acceptMidnightProverPort(remote.port); });
    const provider = makeDeviceProvingProvider({ shielded: false });
    const proving = provider.prove(new Uint8Array([9, 8, 7]), 'midnight/dust/spend', 42n);
    await vi.waitFor(() => expect(remote.posted).toHaveLength(1));
    const request = remote.posted[0];
    expect(request).toMatchObject({ type: 'prove', keyLocation: 'midnight/dust/spend', shielded: false, overwriteBindingInput: '42' });
    expect(request.type === 'prove' && base64ToBytes(request.preimage)).toEqual(new Uint8Array([9, 8, 7]));
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ url: MIDNIGHT_PROVER_DOCUMENT, reasons: ['WORKERS'] }));
    remote.reply({ type: 'busy' });
    remote.reply({ type: 'result', id: (request as { id: number }).id, ok: true, proof: bytesToBase64(new Uint8Array([1, 2, 3])) });
    await expect(proving).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('allows the Zswap circuits only for a shielded provider', async () => {
    const remote = fakePort(ownSender);
    acceptMidnightProverPort(remote.port);
    const proving = makeDeviceProvingProvider({ shielded: true }).prove(new Uint8Array([1]), 'midnight/zswap/output');
    await vi.waitFor(() => expect(remote.posted).toHaveLength(1));
    expect(remote.posted[0]).toMatchObject({ keyLocation: 'midnight/zswap/output', shielded: true });
    remote.reply({ type: 'result', id: (remote.posted[0] as { id: number }).id, ok: true, proof: bytesToBase64(new Uint8Array([5])) });
    await expect(proving).resolves.toEqual(new Uint8Array([5]));
  });

  it('turns a prover error into a DeviceProvingError, and fails in-flight proofs when the document goes away', async () => {
    const remote = fakePort(ownSender);
    acceptMidnightProverPort(remote.port);
    const provider = makeDeviceProvingProvider({ shielded: false });
    const first = provider.prove(new Uint8Array([1]), 'midnight/dust/spend');
    await vi.waitFor(() => expect(remote.posted).toHaveLength(1));
    remote.reply({ type: 'result', id: (remote.posted[0] as { id: number }).id, ok: false, error: 'Proving key dust-9-spend.prover does not match its pinned hash' });
    await expect(first).rejects.toThrow(/On-device proving failed: Proving key .* pinned hash/);

    const second = provider.prove(new Uint8Array([2]), 'midnight/dust/spend');
    await vi.waitFor(() => expect(remote.posted).toHaveLength(2));
    remote.drop();
    await expect(second).rejects.toBeInstanceOf(DeviceProvingError);
  });

  it('runs one proof at a time', async () => {
    const remote = fakePort(ownSender);
    acceptMidnightProverPort(remote.port);
    const provider = makeDeviceProvingProvider({ shielded: false });
    const a = provider.prove(new Uint8Array([1]), 'midnight/dust/spend');
    const b = provider.prove(new Uint8Array([2]), 'midnight/dust/spend');
    await vi.waitFor(() => expect(remote.posted).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(remote.posted).toHaveLength(1);
    remote.reply({ type: 'result', id: (remote.posted[0] as { id: number }).id, ok: true, proof: bytesToBase64(new Uint8Array([1])) });
    await a;
    await vi.waitFor(() => expect(remote.posted).toHaveLength(2));
    remote.reply({ type: 'result', id: (remote.posted[1] as { id: number }).id, ok: true, proof: bytesToBase64(new Uint8Array([2])) });
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });
});

describe('walletProverFor', () => {
  it('proves public sends on this device in Gero Cloud mode on ledger-8 networks', () => {
    expect(walletProverFor('Preprod', { mode: 'remote' }, 'unshielded')).toBe('device');
    expect(walletProverFor('Mainnet', { mode: 'remote' }, 'unshielded')).toBe('device');
  });

  it('keeps private sends on Gero Cloud unless the shielded flag is on', () => {
    expect(walletProverFor('Preprod', { mode: 'remote' }, 'shielded')).toBe('cloud');
    expect(walletProverFor('Preprod', { mode: 'remote' }, 'shielded', { shieldedOnDevice: true })).toBe('device');
  });

  it('leaves Stagenet (ledger 9, no pinned keys) on Gero Cloud', () => {
    expect(walletProverFor('Stagenet', { mode: 'remote' }, 'unshielded')).toBe('cloud');
    expect(walletProverFor('Stagenet', { mode: 'remote' }, 'shielded', { shieldedOnDevice: true })).toBe('cloud');
  });

  it('never overrides a local server or zkPaaS the user chose', () => {
    expect(walletProverFor('Preprod', { mode: 'local' }, 'unshielded')).toBe('local');
    expect(walletProverFor('Preprod', { mode: 'zkpaas' }, 'unshielded')).toBe('zkpaas');
    expect(walletProverFor('Preprod', { mode: 'zkpaas' }, 'shielded', { shieldedOnDevice: true })).toBe('zkpaas');
  });
});
