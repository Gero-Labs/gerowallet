// @vitest-environment node
//
// The Gero Prover client against a fake helper: what it sends, in which order,
// and what it refuses. The fake speaks the wire protocol of
// midnightHelperProtocol.ts over the injected transport; the key files are the
// real bundled DUST set, so the pins are checked for real.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './midnightDeviceProverProtocol';
import {
  GERO_PROVER_CLOSED,
  GERO_PROVER_FORBIDDEN,
  GERO_PROVER_KEYS,
  GERO_PROVER_NOT_ALLOWED,
  GERO_PROVER_NOT_FOUND,
  GERO_PROVER_PROOF_FAILED,
  GERO_PROVER_PROTOCOL,
  GERO_PROVER_UNSUPPORTED_CIRCUIT,
  GERO_PROVER_WRONG_VERSION,
  helperUsesGraphicsProcessor,
  helperVersionAtLeast,
  parseGeroProverSnapshot,
  parseHelperReply,
  type HelperRequest,
  type HelperStatus,
} from './midnightHelperProtocol';
import {
  helperProofProcessor,
  helperStatus,
  HelperProvingError,
  makeHelperProvingProvider,
  removeHelperKeys,
  resetHelperProverForTests,
  runHelperSelfTest,
  setHelperAccelerator,
  takeHelperProofStats,
  type HelperConnect,
  type HelperTransportEvents,
} from './midnightHelperProver';
import { walletProverFor } from './midnightProvingTarget';
import { DUST_SPEND_CIRCUIT, midnightZkFilesFor, ZSWAP_SPEND_CIRCUIT, type MidnightZkFile } from './midnightZkKeys';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';

const BUNDLED_DIR = join(__dirname, '../../assets/midnight-zk');
const DUST_FILES = midnightZkFilesFor([DUST_SPEND_CIRCUIT]);
const DUST = DUST_SPEND_CIRCUIT.keyLocation;

async function readFromDisk(file: MidnightZkFile): Promise<Uint8Array> {
  if (file.source !== 'bundled') throw new Error(`no test copy of ${file.name}`);
  return new Uint8Array(await readFile(join(BUNDLED_DIR, file.name)));
}

const GPU: HelperStatus['accelerator'] = { enabled: true, state: 'active', device: 'Apple M3 Pro', gpuOps: 0, cpuOps: 0 };
const CPU_ONLY: HelperStatus['accelerator'] = { enabled: true, state: 'no-device', gpuOps: 0, cpuOps: 0 };

interface FakeHelperOptions {
  /** The browser closes the port before the helper says anything, with this reason. */
  closeReason?: string;
  /** The browser has not been allowed to talk to native apps. */
  notAllowed?: boolean;
  protocol?: number;
  version?: string;
  accelerator?: HelperStatus['accelerator'];
  /** Key files already on the helper's disk, by name. */
  holds?: string[];
  /** The helper drops what it is sent (a file that did not match its pin). */
  rejectsKeys?: boolean;
  /** Its graphics processor produces a proof that does not verify. */
  gpuFaulty?: boolean;
  /** It cannot make the proof at all. */
  proveFails?: boolean;
  /** It exits while proving. */
  diesWhileProving?: boolean;
}

/** A Gero Prover that lives in the test. `received` is everything the client sent it. */
function fakeHelper(options: FakeHelperOptions = {}) {
  const received: HelperRequest[] = [];
  const held = new Set(options.holds ?? []);
  const incoming = new Map<string, number>();
  const accelerator = { ...(options.accelerator ?? GPU) };
  const state = { connections: 0, closed: 0 };
  let events: HelperTransportEvents | undefined;

  const status = (): HelperStatus => ({
    accelerator: { ...accelerator },
    keys: { files: held.size, bytes: DUST_FILES.filter((f) => held.has(f.name)).reduce((sum, f) => sum + f.bytes, 0) },
    threads: 8,
  });

  function answer(message: HelperRequest): void {
    if (!events || message.type === 'release') return;
    const ok = (extra: Record<string, unknown> = {}) => events?.onMessage({ type: 'result', id: message.id, ok: true, ...extra });
    switch (message.type) {
      case 'hello':
        ok({ hello: { protocol: options.protocol ?? GERO_PROVER_PROTOCOL, version: options.version ?? '1.0.0', os: 'macos' } });
        return;
      case 'configure':
        ok({
          configured: {
            ready: message.files.filter((f) => held.has(f.name)).map((f) => f.name),
            missing: message.files.filter((f) => !held.has(f.name)).map((f) => f.name),
          },
        });
        return;
      case 'keyChunk': {
        const got = (incoming.get(message.name) ?? 0) + base64ToBytes(message.data).length;
        incoming.set(message.name, got);
        if (got === message.total && !options.rejectsKeys) held.add(message.name);
        ok();
        return;
      }
      case 'check':
        ok({ check: ['1', null, '340282366920938463463374607431768211456'] });
        return;
      case 'prove': {
        if (options.diesWhileProving) { events.onClose('Native host has exited.'); return; }
        if (options.proveFails) {
          events.onMessage({ type: 'result', id: message.id, ok: false, code: 'prove-failed', error: 'synthesis failed' });
          return;
        }
        const onGpu = accelerator.state === 'active';
        if (onGpu && options.gpuFaulty) {
          // The graphics processor's proof did not verify: made again on the main processor, and paused.
          accelerator.state = 'tripped';
          accelerator.cpuOps += 1;
          ok({ proof: bytesToBase64(new Uint8Array([9, 9, 9])), proveMs: 2100, accelerated: false, cpuRetry: true });
          return;
        }
        if (onGpu) accelerator.gpuOps += 1; else accelerator.cpuOps += 1;
        ok({ proof: bytesToBase64(new Uint8Array([1, 2, 3, 4])), proveMs: onGpu ? 900 : 1600, accelerated: onGpu });
        return;
      }
      case 'status':
        ok({ status: status() });
        return;
      case 'setAccelerator':
        accelerator.enabled = message.enabled;
        if (accelerator.state === 'active' || accelerator.state === 'off' || accelerator.state === 'tripped') {
          accelerator.state = message.enabled ? 'active' : 'off';
        }
        ok({ status: status() });
        return;
      case 'removeKeys':
        held.clear();
        ok({ status: status() });
        return;
      case 'selfTest':
        ok({ selfTest: { proveMs: 1200, accelerated: accelerator.state === 'active' } });
        return;
      default:
    }
  }

  const connect: HelperConnect = async (transportEvents) => {
    if (options.notAllowed) throw new HelperProvingError(GERO_PROVER_NOT_ALLOWED);
    state.connections += 1;
    events = transportEvents;
    if (options.closeReason !== undefined) queueMicrotask(() => transportEvents.onClose(options.closeReason));
    return {
      post: (message) => {
        received.push(message);
        queueMicrotask(() => answer(message));
      },
      close: () => { state.closed += 1; },
    };
  };

  return { connect, received, state, types: () => received.map((m) => m.type) };
}

function install(options: FakeHelperOptions = {}, readKey: (file: MidnightZkFile) => Promise<Uint8Array> = readFromDisk) {
  const helper = fakeHelper(options);
  resetHelperProverForTests({ connect: helper.connect, readFile: readKey });
  return helper;
}

const ALL_DUST = DUST_FILES.map((f) => f.name);
const PREIMAGE = new Uint8Array([7, 7, 7, 7, 7]);

describe('midnightHelperProtocol', () => {
  it('accepts a well-formed reply and drops a malformed one whole', () => {
    expect(parseHelperReply({ type: 'result', id: 3, ok: true, proof: 'AQID', proveMs: 12, accelerated: true }))
      .toEqual({ type: 'result', id: 3, ok: true, proof: 'AQID', proveMs: 12, accelerated: true });
    expect(parseHelperReply({ type: 'result', id: 3, ok: true, proof: 'not base64!' })).toBeUndefined();
    expect(parseHelperReply({ type: 'result', id: 3, ok: true, check: ['1', 'x'] })).toBeUndefined();
    expect(parseHelperReply({ type: 'result', id: 3, ok: true, status: { accelerator: { state: 'warp' } } })).toBeUndefined();
    expect(parseHelperReply({ type: 'result', id: -1, ok: true })).toBeUndefined();
    expect(parseHelperReply('hello')).toBeUndefined();
    expect(parseHelperReply({ type: 'busy' })).toEqual({ type: 'busy' });
  });

  it('keeps only a known error code, and never a long or multi-line helper message', () => {
    expect(parseHelperReply({ type: 'result', id: 1, ok: false, code: 'rm -rf', error: `line one\nline two ${'x'.repeat(200)}` }))
      .toEqual({ type: 'result', id: 1, ok: false, code: 'internal', error: expect.stringMatching(/^line oneline two x{43}$/) });
  });

  it('shows a device name as plain short text', () => {
    const reply = parseHelperReply({
      type: 'result', id: 1, ok: true,
      status: { accelerator: { enabled: true, state: 'active', device: '<b>Apple‮ M3</b>\n', gpuOps: 1, cpuOps: 2 }, keys: { files: 4, bytes: 10 }, threads: 8 },
    });
    expect(reply && reply.type === 'result' && reply.ok && reply.status?.accelerator.device).toBe('<b>Apple M3</b>');
  });

  it('compares releases numerically', () => {
    expect(helperVersionAtLeast('1.0.0', '1.0.0')).toBe(true);
    expect(helperVersionAtLeast('1.10.0', '1.9.3')).toBe(true);
    expect(helperVersionAtLeast('0.9.9', '1.0.0')).toBe(false);
    expect(helperVersionAtLeast('1.0', '1.0.0')).toBe(false);
  });

  it('reads a snapshot from the background, and "connected" only with a status', () => {
    expect(parseGeroProverSnapshot({ connection: 'connected' })).toEqual({ connection: 'error' });
    expect(parseGeroProverSnapshot({ connection: 'not-found', version: 'x' })).toEqual({ connection: 'not-found' });
    expect(parseGeroProverSnapshot(null)).toEqual({ connection: 'error' });
    const status: HelperStatus = { accelerator: GPU, keys: { files: 4, bytes: 10 }, threads: 8 };
    const snapshot = parseGeroProverSnapshot({ connection: 'connected', version: '1.2.0', os: 'macos', status });
    expect(snapshot).toEqual({ connection: 'connected', version: '1.2.0', os: 'macos', status });
    expect(helperUsesGraphicsProcessor(snapshot)).toBe(true);
    expect(helperUsesGraphicsProcessor({ connection: 'not-found' })).toBe(false);
  });
});

describe('walletProverFor with Gero Prover', () => {
  // Preprod crossed to ledger 9; mainnet here is a chain still on ledger 8.
  beforeEach(() => useMidnightChains({ preprod: [L9, L8], mainnet: [L8, L8] }));
  const helperChosen = { mode: 'local', localEngine: 'helper' } as const;

  it('is the helper only when the user chose it AND it is offered', () => {
    expect(walletProverFor('Preprod', helperChosen, 'unshielded', { helper: true })).toBe('helper');
    expect(walletProverFor('Preprod', helperChosen, 'shielded', { helper: true })).toBe('helper');
    // The flag off: the stored choice reads as the Docker server, as before the helper existed.
    expect(walletProverFor('Preprod', helperChosen, 'unshielded')).toBe('local');
    expect(walletProverFor('Preprod', helperChosen, 'unshielded', { helper: false })).toBe('local');
    // The flag on, and no choice of the helper: nothing changes.
    expect(walletProverFor('Preprod', { mode: 'local' }, 'unshielded', { helper: true })).toBe('local');
    expect(walletProverFor('Preprod', { mode: 'local', localEngine: 'docker' }, 'unshielded', { helper: true })).toBe('local');
  });

  it('never changes Gero Cloud or Arkhia, and keeps the Docker server on a ledger 8 chain', () => {
    expect(walletProverFor('Preprod', { mode: 'remote', localEngine: 'helper' }, 'unshielded', { helper: true })).toBe('device');
    expect(walletProverFor('Preprod', { mode: 'remote', localEngine: 'helper' }, 'shielded', { helper: true })).toBe('cloud');
    expect(walletProverFor('Preprod', { mode: 'zkpaas', localEngine: 'helper' }, 'shielded', { helper: true })).toBe('zkpaas');
    expect(walletProverFor('Mainnet', helperChosen, 'unshielded', { helper: true })).toBe('local');
  });
});

describe('midnightHelperProver', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '2.8.0' }) } });
  });

  afterEach(() => {
    resetHelperProverForTests();
    vi.unstubAllGlobals();
  });

  describe('connected, with a graphics processor', () => {
    it('says hello, configures the pinned keys, then proves', async () => {
      const helper = install({ holds: ALL_DUST });
      const proof = await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST, 5n);

      expect(proof).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(helper.types()).toEqual(['hello', 'configure', 'prove']);
      expect(helper.received[0]).toMatchObject({ type: 'hello', protocol: GERO_PROVER_PROTOCOL, client: 'gerowallet/2.8.0' });
      // The helper is told the pins of this build, and nothing but the DUST circuit.
      const configure = helper.received[1] as Extract<HelperRequest, { type: 'configure' }>;
      expect(configure.circuits.map((c) => c.keyLocation)).toEqual([DUST]);
      expect(configure.files).toEqual(DUST_FILES.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })));
      // The same request shape as the offscreen prover's.
      expect(helper.received[2]).toMatchObject({
        type: 'prove', keyLocation: DUST, shielded: false, preimage: bytesToBase64(PREIMAGE), overwriteBindingInput: '5',
      });
      expect(takeHelperProofStats()).toEqual({ gpu: 1, cpu: 0, cpuRetry: false });
      expect(takeHelperProofStats()).toEqual({ gpu: 0, cpu: 0, cpuRetry: false });
    });

    it('a transaction with one graphics-processor proof reads as proved there', async () => {
      install({ holds: ALL_DUST });
      const provider = makeHelperProvingProvider({ shielded: false });
      await provider.prove(PREIMAGE, DUST);
      await setHelperAccelerator(false);
      await provider.prove(PREIMAGE, DUST);
      expect(helperProofProcessor()).toEqual({ processor: 'gpu' });
    });

    it('reports the device and that it is in use', async () => {
      install({ holds: ALL_DUST });
      const snapshot = await helperStatus();
      expect(snapshot).toMatchObject({ connection: 'connected', version: '1.0.0', os: 'macos' });
      expect(snapshot.status?.accelerator).toMatchObject({ state: 'active', device: 'Apple M3 Pro' });
      expect(helperUsesGraphicsProcessor(snapshot)).toBe(true);
    });

    it('checks a preimage and decodes the result', async () => {
      install({ holds: ALL_DUST });
      const result = await makeHelperProvingProvider({ shielded: false }).check(PREIMAGE, DUST);
      expect(result).toEqual([1n, undefined, 2n ** 128n]);
    });

    it('reuses one connection and one configure for several proofs', async () => {
      const helper = install({ holds: ALL_DUST });
      const provider = makeHelperProvingProvider({ shielded: false });
      await Promise.all([provider.prove(PREIMAGE, DUST), provider.prove(PREIMAGE, DUST)]);
      expect(helper.state.connections).toBe(1);
      expect(helper.types()).toEqual(['hello', 'configure', 'prove', 'prove']);
    });

    it('switches the graphics processor off and on', async () => {
      install({ holds: ALL_DUST });
      expect((await setHelperAccelerator(false)).status?.accelerator).toMatchObject({ enabled: false, state: 'off' });
      await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST);
      expect(takeHelperProofStats()).toMatchObject({ gpu: 0, cpu: 1 });
      expect((await setHelperAccelerator(true)).status?.accelerator.state).toBe('active');
    });

    it('runs the helper own test proof, with its keys in place first', async () => {
      const helper = install({ holds: ALL_DUST });
      expect(await runHelperSelfTest()).toEqual({ proveMs: 1200, accelerated: true });
      expect(helper.types()).toEqual(['hello', 'configure', 'selfTest']);
    });
  });

  describe('connected, main processor only', () => {
    it('proves on the main processor and says so', async () => {
      install({ holds: ALL_DUST, accelerator: CPU_ONLY });
      const proof = await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST);
      expect(proof).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(takeHelperProofStats()).toEqual({ gpu: 0, cpu: 1, cpuRetry: false });
      const snapshot = await helperStatus();
      expect(snapshot.status?.accelerator.state).toBe('no-device');
      expect(helperUsesGraphicsProcessor(snapshot)).toBe(false);
    });
  });

  describe('graphics processor tripped', () => {
    it('returns the main processor proof, records the retry, and reads as paused until turned back on', async () => {
      install({ holds: ALL_DUST, gpuFaulty: true });
      const provider = makeHelperProvingProvider({ shielded: false });

      // The send goes through: the helper already made the proof again.
      expect(await provider.prove(PREIMAGE, DUST)).toEqual(new Uint8Array([9, 9, 9]));
      expect(takeHelperProofStats()).toEqual({ gpu: 0, cpu: 1, cpuRetry: true });
      expect((await helperStatus()).status?.accelerator.state).toBe('tripped');

      // It stays on the main processor, with no further retry.
      await provider.prove(PREIMAGE, DUST);
      expect(takeHelperProofStats()).toEqual({ gpu: 0, cpu: 1, cpuRetry: false });

      // "Turn back on" clears the trip.
      expect((await setHelperAccelerator(true)).status?.accelerator.state).toBe('active');
    });

    it('marks the history row of that transaction, and only that one', async () => {
      install({ holds: ALL_DUST, gpuFaulty: true });
      const provider = makeHelperProvingProvider({ shielded: false });
      await provider.prove(PREIMAGE, DUST);
      expect(helperProofProcessor()).toEqual({ processor: 'cpu', cpuRetry: true });
      await provider.prove(PREIMAGE, DUST);
      expect(helperProofProcessor()).toEqual({ processor: 'cpu' });
    });
  });

  describe('helper missing', () => {
    it('fails a proof with one code and sends the helper nothing but hello', async () => {
      const helper = install({ closeReason: 'Specified native messaging host not found.' });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ name: 'HelperProvingError', message: GERO_PROVER_NOT_FOUND });
      expect(helper.types().filter((type) => type !== 'hello')).toEqual([]);
      expect(await helperStatus()).toEqual({ connection: 'not-found' });
    });

    it('tells a helper registered for another copy of the extension apart', async () => {
      install({ closeReason: 'Access to the specified native messaging host is forbidden.' });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_FORBIDDEN });
      expect(await helperStatus()).toEqual({ connection: 'forbidden' });
    });

    it('does not start anything while the browser permission is missing', async () => {
      const helper = install({ notAllowed: true });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_NOT_ALLOWED });
      expect(helper.state.connections).toBe(0);
      expect(await helperStatus()).toEqual({ connection: 'not-allowed' });
    });

    it('tries again on the next request, so a helper installed meanwhile is found', async () => {
      install({ closeReason: 'Specified native messaging host not found.' });
      expect((await helperStatus()).connection).toBe('not-found');
      install({ holds: ALL_DUST });
      expect((await helperStatus()).connection).toBe('connected');
    });
  });

  describe('wrong version', () => {
    it('refuses another protocol before any key or witness is sent', async () => {
      const helper = install({ protocol: GERO_PROVER_PROTOCOL + 1, version: '2.0.0', holds: ALL_DUST });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_WRONG_VERSION });
      expect(helper.types()).toEqual(['hello']);
      expect(helper.state.closed).toBe(1);
      expect(await helperStatus()).toEqual({ connection: 'wrong-version', version: '2.0.0', os: 'macos' });
    });

    it('refuses a release older than the minimum', async () => {
      const helper = install({ version: '0.9.4', holds: ALL_DUST });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_WRONG_VERSION });
      expect(helper.types()).toEqual(['hello']);
    });
  });

  describe('a proof that fails', () => {
    it('fails with one code and tries nothing else', async () => {
      const helper = install({ holds: ALL_DUST, proveFails: true });
      const error = await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HelperProvingError);
      // The code only: the helper own text never reaches the user or a log.
      expect((error as Error).message).toBe(GERO_PROVER_PROOF_FAILED);
      expect(helper.types()).toEqual(['hello', 'configure', 'prove']);
      expect(takeHelperProofStats()).toEqual({ gpu: 0, cpu: 0, cpuRetry: false });
    });

    it('fails when the helper exits mid-proof, and reconnects for the next one', async () => {
      install({ holds: ALL_DUST, diesWhileProving: true });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_CLOSED });
      const healthy = install({ holds: ALL_DUST });
      await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST);
      expect(healthy.types()).toEqual(['hello', 'configure', 'prove']);
    });
  });

  describe('key files', () => {
    it('hands over what the helper lacks, whole and verified, before the witness', async () => {
      const helper = install({ holds: [] });
      await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST);

      const types = helper.types();
      expect(types[0]).toBe('hello');
      expect(types[1]).toBe('configure');
      expect(types.at(-2)).toBe('configure');
      expect(types.at(-1)).toBe('prove');
      // Every file of the circuit, every byte of it.
      const sent = new Map<string, number>();
      for (const message of helper.received) {
        if (message.type !== 'keyChunk') continue;
        expect(message.offset).toBe(sent.get(message.name) ?? 0);
        sent.set(message.name, message.offset + base64ToBytes(message.data).length);
      }
      expect([...sent.entries()].sort()).toEqual(DUST_FILES.map((f) => [f.name, f.bytes]).sort());
    });

    it('sends only the files that are missing', async () => {
      const helper = install({ holds: ALL_DUST.filter((name) => name !== DUST_SPEND_CIRCUIT.ir.name) });
      await makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST);
      const names = helper.received.filter((m) => m.type === 'keyChunk').map((m) => (m as { name: string }).name);
      expect([...new Set(names)]).toEqual([DUST_SPEND_CIRCUIT.ir.name]);
    });

    it('sends no witness to a helper that still does not hold the keys', async () => {
      const helper = install({ holds: [], rejectsKeys: true });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_KEYS });
      expect(helper.types()).not.toContain('prove');
    });

    it('never hands over a file that does not match its pin', async () => {
      const helper = install({ holds: [] }, async (file) => {
        const bytes = await readFromDisk(file);
        if (file.name === DUST_SPEND_CIRCUIT.prover.name) bytes[100] ^= 0xff;
        return bytes;
      });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, DUST))
        .rejects.toMatchObject({ message: GERO_PROVER_KEYS });
      const names = helper.received.filter((m) => m.type === 'keyChunk').map((m) => (m as { name: string }).name);
      expect(names).not.toContain(DUST_SPEND_CIRCUIT.prover.name);
      expect(helper.types()).not.toContain('prove');
    });

    it('fails a shielded proof whose keys this build cannot read, before the witness', async () => {
      const helper = install({ holds: ALL_DUST });
      await expect(makeHelperProvingProvider({ shielded: true }).prove(PREIMAGE, ZSWAP_SPEND_CIRCUIT.keyLocation))
        .rejects.toMatchObject({ message: GERO_PROVER_KEYS });
      expect(helper.types()).not.toContain('prove');
    });

    it('configures again after the files were removed', async () => {
      const helper = install({ holds: ALL_DUST });
      const provider = makeHelperProvingProvider({ shielded: false });
      await provider.prove(PREIMAGE, DUST);
      expect((await removeHelperKeys()).status?.keys.files).toBe(0);
      await provider.prove(PREIMAGE, DUST);
      const afterRemove = helper.types().slice(helper.types().indexOf('removeKeys') + 1);
      expect(afterRemove[0]).toBe('configure');
      expect(afterRemove).toContain('keyChunk');
      expect(afterRemove.at(-1)).toBe('prove');
    });
  });

  describe('scope', () => {
    it('refuses a Zswap circuit without the shielded scope, before connecting', async () => {
      const helper = install({ holds: ALL_DUST });
      await expect(makeHelperProvingProvider({ shielded: false }).prove(PREIMAGE, ZSWAP_SPEND_CIRCUIT.keyLocation))
        .rejects.toMatchObject({ message: GERO_PROVER_UNSUPPORTED_CIRCUIT });
      expect(helper.state.connections).toBe(0);
    });

    it('refuses a circuit that is not a pinned built-in, with or without the shielded scope', async () => {
      const helper = install({ holds: ALL_DUST });
      await expect(makeHelperProvingProvider({ shielded: true }).check(PREIMAGE, 'some-dapp/contract/transfer'))
        .rejects.toMatchObject({ message: GERO_PROVER_UNSUPPORTED_CIRCUIT });
      expect(helper.state.connections).toBe(0);
    });
  });
});
