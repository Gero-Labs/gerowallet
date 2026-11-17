// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  NIGHT_RAW_TOKEN_TYPE,
  connectorIntentSyncReady,
  connectorSegmentSpecifier,
  expectedIntentImbalances,
  uncoveredIntentInput,
  validateConnectorIntentRequest,
} from './midnightConnectorIntent';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import { forgetMidnightLedgersForTests } from './midnightLedger';
import {
  LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useDefaultMidnightChainsForTests, useMidnightChains,
} from '@test/helpers/midnightChains';

const FOO = 'aB'.repeat(32);

function recipient(network = 'preprod', fill = 1): string {
  return UnshieldedAddress.codec.encode(network, new UnshieldedAddress(Buffer.alloc(32, fill))).asString();
}

function request(overrides: Record<string, unknown> = {}, network = 'preprod') {
  return {
    desiredInputs: [{ kind: 'unshielded', type: NIGHT_RAW_TOKEN_TYPE, value: '30' }],
    desiredOutputs: [{ kind: 'unshielded', type: FOO, value: '7', recipient: recipient(network) }],
    options: { intentId: 'random', payFees: true },
    ...overrides,
  };
}

function utxo(tokenType: string, value: bigint): MidnightUnshieldedUtxo {
  return { owner: 'mn_addr_preprod1x', tokenType, value, intentHash: 'h', outputIndex: 0 } as MidnightUnshieldedUtxo;
}

describe('validateConnectorIntentRequest', () => {
  it.each(['Mainnet', 'Preprod'])('accepts a public swap on %s and normalizes colours', network => {
    const req = request({}, network.toLowerCase());
    expect(validateConnectorIntentRequest(req, network)).toEqual({
      ok: true,
      inputs: [{ type: NIGHT_RAW_TOKEN_TYPE, value: '30' }],
      outputs: [{ kind: 'unshielded', type: FOO.toLowerCase(), value: '7', recipient: req.desiredOutputs[0].recipient }],
      intentId: 'random',
      payFees: true,
    });
  });

  describe('the chain\'s ledger', () => {
    afterEach(() => useDefaultMidnightChainsForTests());

    it('accepts a public swap on a ledger 9 chain: born on it (Stagenet) or crossed to it (Preprod)', () => {
      expect(validateConnectorIntentRequest(request({}, 'stagenet'), 'Stagenet')).toMatchObject({ ok: true, intentId: 'random' });
      useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
      expect(validateConnectorIntentRequest(request(), 'Preprod')).toMatchObject({ ok: true });
    });

    it('refuses a chain whose ledger has not been read, before anything else, and never guesses from the name', () => {
      forgetMidnightLedgersForTests();
      for (const network of ['Preprod', 'Mainnet', 'Stagenet']) {
        expect(validateConnectorIntentRequest(request({}, network.toLowerCase()), network))
          .toMatchObject({ ok: false, reason: expect.stringContaining(`Could not read which ledger Midnight ${network} runs`) });
      }
      expect(validateConnectorIntentRequest(request(), 'testnet').ok).toBe(false);
    });
  });

  it('refuses shielded legs on either side', () => {
    const shieldedIn = request({ desiredInputs: [{ kind: 'shielded', type: FOO, value: '1' }] });
    const shieldedOut = request({ desiredOutputs: [{ kind: 'shielded', type: FOO, value: '1', recipient: recipient() }] });
    for (const req of [shieldedIn, shieldedOut]) {
      expect(validateConnectorIntentRequest(req, 'preprod')).toMatchObject({ ok: false, reason: expect.stringContaining('unshielded') });
    }
  });

  it('refuses a give-only intent and an empty one, but allows a want-only intent', () => {
    expect(validateConnectorIntentRequest(request({ desiredOutputs: [] }), 'preprod').ok).toBe(false);
    expect(validateConnectorIntentRequest(request({ desiredInputs: [], desiredOutputs: [] }), 'preprod').ok).toBe(false);
    expect(validateConnectorIntentRequest(request({ desiredInputs: [] }), 'preprod')).toMatchObject({ ok: true, inputs: [] });
  });

  it.each([0, -1, 1.5, 65_536, 'rnd', '7', null, undefined])('refuses intentId %#', intentId => {
    expect(validateConnectorIntentRequest(request({ options: { intentId, payFees: true } }), 'preprod').ok).toBe(false);
  });

  it.each([1, 65_535, 'random'])('accepts intentId %s', intentId => {
    expect(validateConnectorIntentRequest(request({ options: { intentId, payFees: false } }), 'preprod'))
      .toMatchObject({ ok: true, intentId, payFees: false });
  });

  it('requires options and an explicit boolean payFees', () => {
    for (const options of [undefined, null, [], { intentId: 1 }, { intentId: 1, payFees: 'yes' }]) {
      expect(validateConnectorIntentRequest(request({ options }), 'preprod').ok).toBe(false);
    }
  });

  it.each(['0', '-1', '1.5', '0x20', ' 1 ', true, 42, '9'.repeat(81)])('refuses malformed amount %#', value => {
    expect(validateConnectorIntentRequest(request({ desiredInputs: [{ kind: 'unshielded', type: FOO, value }] }), 'preprod').ok).toBe(false);
    expect(validateConnectorIntentRequest(
      request({ desiredOutputs: [{ kind: 'unshielded', type: FOO, value, recipient: recipient() }] }), 'preprod',
    ).ok).toBe(false);
  });

  it.each(['nothex', 'a'.repeat(63), '0'.repeat(65), '__proto__', false])('refuses token colour %#', type => {
    expect(validateConnectorIntentRequest(request({ desiredInputs: [{ kind: 'unshielded', type, value: '1' }] }), 'preprod').ok).toBe(false);
  });

  it('refuses a recipient on another network', () => {
    const req = request({ desiredOutputs: [{ kind: 'unshielded', type: FOO, value: '1', recipient: recipient('mainnet') }] });
    expect(validateConnectorIntentRequest(req, 'preprod').ok).toBe(false);
  });

  it('caps each side at 100 entries', () => {
    const many = Array.from({ length: 101 }, () => ({ kind: 'unshielded', type: FOO, value: '1' }));
    expect(validateConnectorIntentRequest(request({ desiredInputs: many }), 'preprod').ok).toBe(false);
    const wants = Array.from({ length: 101 }, () => ({ kind: 'unshielded', type: FOO, value: '1', recipient: recipient() }));
    expect(validateConnectorIntentRequest(request({ desiredOutputs: wants }), 'preprod').ok).toBe(false);
  });

  it('sums duplicate input colours and defaults an empty colour to NIGHT', () => {
    const result = validateConnectorIntentRequest(request({
      desiredInputs: [
        { kind: 'unshielded', value: '5' },
        { kind: 'unshielded', type: '', value: '6' },
        { kind: 'unshielded', type: FOO, value: '2' },
      ],
    }), 'preprod');
    expect(result).toMatchObject({
      ok: true,
      inputs: [{ type: NIGHT_RAW_TOKEN_TYPE, value: '11' }, { type: FOO.toLowerCase(), value: '2' }],
    });
  });

  it('refuses a non-object request and non-array sides', () => {
    for (const data of [null, 'x', [], { ...request(), desiredInputs: 'x' }, { ...request(), desiredOutputs: {} }]) {
      expect(validateConnectorIntentRequest(data, 'preprod').ok).toBe(false);
    }
  });
});

describe('expectedIntentImbalances', () => {
  it('nets each colour as given minus wanted and drops balanced colours', () => {
    const net = expectedIntentImbalances({
      inputs: [{ type: NIGHT_RAW_TOKEN_TYPE, value: '30' }, { type: 'cc'.repeat(32), value: '4' }],
      outputs: [
        { kind: 'unshielded', type: 'ab'.repeat(32), value: '7', recipient: 'r' },
        { kind: 'unshielded', type: NIGHT_RAW_TOKEN_TYPE, value: '10', recipient: 'r' },
        { kind: 'unshielded', type: 'cc'.repeat(32), value: '4', recipient: 'r' },
      ],
    });
    expect([...net]).toEqual([[NIGHT_RAW_TOKEN_TYPE, 20n], ['ab'.repeat(32), -7n]]);
  });
});

describe('uncoveredIntentInput', () => {
  it('returns the first input the synced UTxOs cannot cover', () => {
    const utxos = { lastSync: 1, utxos: [utxo('', 20n), utxo(NIGHT_RAW_TOKEN_TYPE, 15n), utxo(FOO, 3n)] };
    expect(uncoveredIntentInput([{ type: NIGHT_RAW_TOKEN_TYPE, value: '35' }], utxos)).toBeUndefined();
    expect(uncoveredIntentInput([{ type: NIGHT_RAW_TOKEN_TYPE, value: '36' }], utxos)).toEqual({ type: NIGHT_RAW_TOKEN_TYPE, value: '36' });
    // Indexer colours may be upper-case; inputs are normalized to lower-case.
    expect(uncoveredIntentInput([{ type: FOO.toLowerCase(), value: '3' }], utxos)).toBeUndefined();
    expect(uncoveredIntentInput([{ type: 'cc'.repeat(32), value: '1' }], utxos)).toEqual({ type: 'cc'.repeat(32), value: '1' });
  });

  it('covers a want-only intent with no inputs', () => {
    expect(uncoveredIntentInput([], { lastSync: 1, utxos: [] })).toBeUndefined();
  });

  it('says nothing before the first sync (worker restart, wallet switch): the empty UTxO list is not known', () => {
    expect(uncoveredIntentInput([{ type: NIGHT_RAW_TOKEN_TYPE, value: '1' }], { lastSync: null, utxos: [] })).toBeUndefined();
    expect(uncoveredIntentInput([{ type: NIGHT_RAW_TOKEN_TYPE, value: '1' }], { lastSync: 1, utxos: [] }))
      .toEqual({ type: NIGHT_RAW_TOKEN_TYPE, value: '1' });
  });
});

describe('connectorIntentSyncReady (review S1: a ledger 9 intent is funded from the wallet\'s own sync)', () => {
  const own = recipient('preprod', 1);
  it('needs a validated sync for an address', () => {
    expect(connectorIntentSyncReady({ lastSync: null, addresses: { unshielded: own } })).toBe(false);
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: {} })).toBe(false);
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: { unshielded: '' } })).toBe(false);
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: { unshielded: own } })).toBe(true);
  });

  it('with the signing key\'s address, needs the sync to follow that address (any case)', () => {
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: { unshielded: own } }, own.toUpperCase())).toBe(true);
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: { unshielded: own } }, recipient('preprod', 2))).toBe(false);
    // The same key on another network is another address.
    expect(connectorIntentSyncReady({ lastSync: 1, addresses: { unshielded: own } }, recipient('mainnet', 1))).toBe(false);
  });
});

describe('connectorSegmentSpecifier', () => {
  it('maps the dapp\'s intentId to the ledger\'s segment specifier', () => {
    expect(connectorSegmentSpecifier('random')).toEqual({ tag: 'random' });
    expect(connectorSegmentSpecifier(4242)).toEqual({ tag: 'specific', value: 4242 });
  });
});
