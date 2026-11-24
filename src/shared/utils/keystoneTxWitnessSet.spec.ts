// A Keystone answers a full-transaction request with CardanoSignature { request id, witness set },
// but a tx-hash request (2048 bytes or more) with the bare witness set: keystone3-firmware encodes
// sign_tx_hash's witness_set.to_bytes() straight into the cardano-signature UR. Read as the wrapped
// form that answer had no request id and no witness set, so every hash-route signature was refused
// as "Invalid Keystone signature" (QA on a Keystone 3, firmware 2.4.2, issue 1518).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Serialization, type Cardano } from '@cardano-sdk/core';
import { Ed25519PrivateKey, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CardanoSignature } from '@keystonehq/bc-ur-registry-cardano';

// keystone.ts pulls in the i18n plugin and the worker preflight; neither matters here.
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/shared/utils/cip113SignPreflight', () => ({ assertCip113SignAllowed: vi.fn() }));

import { keystoneTxWitnessSet } from './keystone';

// Vitest externalizes the CJS registry, which uses Node's Buffer: build wire fixtures with it, not
// Vite's browser polyfill (as keystone.spec.ts does).
const RegistryBuffer = (createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer')).Buffer;

// Synthetic key and hashes, never a real wallet's.
const TX_HASH = 'ab'.repeat(32);
const OTHER_HASH = 'cd'.repeat(32);
const REQUEST_ID = '0cb9d644-785d-4867-aa4a-0302e6e61a64';
const REQUEST_ID_BYTES = RegistryBuffer.from(REQUEST_ID.replace(/-/g, ''), 'hex');

let key: Ed25519PrivateKey;
beforeAll(async () => {
  await ready();
  key = Ed25519PrivateKey.fromNormalBytes(new Uint8Array(32).fill(7));
});

/** The witness set CBOR a device returns for one signature over `hash`. */
const witnessSetOver = (hash: string): string => {
  const signatures: Cardano.Signatures = new Map([[key.toPublic().hex(), key.sign(HexBlob(hash)).hex()]]);
  return Serialization.TransactionWitnessSet.fromCore({ signatures }).toCbor();
};

const ur = (cbor: Buffer, type = 'cardano-signature') => ({ type, cbor }) as never;
/** What the firmware sends for a tx-hash request: the bare witness set. */
const bareAnswer = (hash: string) => ur(Buffer.from(witnessSetOver(hash), 'hex'));
/** What it sends for a full-transaction request: the witness set wrapped with the request id. */
const wrappedAnswer = (hash: string, requestId = REQUEST_ID_BYTES) =>
  ur(new CardanoSignature(RegistryBuffer.from(witnessSetOver(hash), 'hex'), requestId).toCBOR());

describe('keystoneTxWitnessSet', () => {
  it('reads a wrapped full-transaction answer for this request', async () => {
    await expect(keystoneTxWitnessSet(wrappedAnswer(TX_HASH), { requestId: REQUEST_ID, txHash: null }))
      .resolves.toBe(witnessSetOver(TX_HASH));
  });

  it('refuses a wrapped answer to another request', async () => {
    const other = RegistryBuffer.from('11'.repeat(16), 'hex');
    await expect(keystoneTxWitnessSet(wrappedAnswer(TX_HASH, other), { requestId: REQUEST_ID, txHash: null }))
      .rejects.toThrow('Invalid Keystone signature');
  });

  it('reads the bare witness set a tx-hash request is answered with', async () => {
    await expect(keystoneTxWitnessSet(bareAnswer(TX_HASH), { requestId: REQUEST_ID, txHash: TX_HASH }))
      .resolves.toBe(witnessSetOver(TX_HASH));
  });

  it('refuses a bare witness set signed over another transaction', async () => {
    await expect(keystoneTxWitnessSet(bareAnswer(OTHER_HASH), { requestId: REQUEST_ID, txHash: TX_HASH }))
      .rejects.toThrow('Invalid Keystone signature');
  });

  it('refuses a bare witness set when no hash was asked for (a full-transaction request)', async () => {
    await expect(keystoneTxWitnessSet(bareAnswer(TX_HASH), { requestId: REQUEST_ID, txHash: null }))
      .rejects.toThrow('Invalid Keystone signature');
  });

  it('refuses an empty answer and another UR type', async () => {
    const empty = Serialization.TransactionWitnessSet.fromCore({ signatures: new Map() }).toCbor();
    await expect(keystoneTxWitnessSet(ur(Buffer.from(empty, 'hex')), { requestId: REQUEST_ID, txHash: TX_HASH }))
      .rejects.toThrow('Invalid Keystone signature');
    await expect(keystoneTxWitnessSet(ur(Buffer.from(witnessSetOver(TX_HASH), 'hex'), 'crypto-psbt'), { txHash: TX_HASH }))
      .rejects.toThrow('Invalid Keystone signature');
  });
});
