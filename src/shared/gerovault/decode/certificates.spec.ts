import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { certificateDeposits, certificateTagRefusal, decodeCertificate, decodeCertificates, RENDERED_CERTIFICATE_TAGS } from './certificates';
import { fromHex } from './cbor';
import type { DecodeContext } from './context';
import { FieldRefusal, Refusals } from './refusals';
import { array, bytes, POOL_KEY_HASH, uint, VAULT_SCRIPT_HASH } from './__fixtures__/vaultTxs';

const ctx = (stakeKeyDepositLovelace: bigint | null = 2_000_000n): DecodeContext => ({
  networkId: 0,
  stakeKeyDepositLovelace: stakeKeyDepositLovelace ?? undefined,
  refusals: new Refusals(),
});
const cred = array(uint(1), bytes(VAULT_SCRIPT_HASH));
const keyCred = array(uint(0), bytes('ab'.repeat(28)));
const credential = { kind: 'script', hash: VAULT_SCRIPT_HASH };
const pool = { keyHash: POOL_KEY_HASH, poolId: String(Cardano.PoolId.fromKeyHash(POOL_KEY_HASH as never)) };
const decode = (hex: string, c = ctx()) => decodeCertificate(fromHex(hex), 'c', c);
const refusalOf = (hex: string, c = ctx()) => {
  try {
    decode(hex, c);
  } catch (e) {
    if (e instanceof FieldRefusal) return e.refusal;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('decodeCertificate: rendered', () => {
  it('Shelley registration and deregistration take the protocol deposit', () => {
    expect(decode(array(uint(0), cred))).toEqual({ kind: 'stake_registration', form: 'shelley', credential, deposit: { lovelace: 2_000_000n, source: 'protocol' } });
    expect(decode(array(uint(1), keyCred))).toEqual({
      kind: 'stake_deregistration', form: 'shelley', credential: { kind: 'key', hash: 'ab'.repeat(28) }, refund: { lovelace: 2_000_000n, source: 'protocol' },
    });
  });

  it('Conway registration and deregistration state their amount', () => {
    expect(decode(array(uint(7), cred, uint(3_000_000)))).toEqual({ kind: 'stake_registration', form: 'conway', credential, deposit: { lovelace: 3_000_000n, source: 'body' } });
    expect(decode(array(uint(8), cred, uint(3_000_000)))).toEqual({ kind: 'stake_deregistration', form: 'conway', credential, refund: { lovelace: 3_000_000n, source: 'body' } });
  });

  it('delegation and registration with delegation name the pool in full', () => {
    expect(decode(array(uint(2), cred, bytes(POOL_KEY_HASH)))).toEqual({ kind: 'stake_delegation', credential, pool });
    expect(decode(array(uint(11), cred, bytes(POOL_KEY_HASH), uint(2_000_000)))).toEqual({
      kind: 'stake_registration_delegation', credential, pool, deposit: { lovelace: 2_000_000n, source: 'body' },
    });
  });

  it('sums deposits paid and refunds returned', () => {
    const views = [
      decode(array(uint(7), cred, uint(2_000_000))),
      decode(array(uint(11), cred, bytes(POOL_KEY_HASH), uint(1_000_000))),
      decode(array(uint(8), cred, uint(500_000))),
      decode(array(uint(2), cred, bytes(POOL_KEY_HASH))),
    ];
    expect(certificateDeposits(views)).toEqual({ paid: 3_000_000n, refunded: 500_000n });
  });
});

describe('decodeCertificate: refused', () => {
  it.each([
    [3, 'certificate_pool_unsupported'],
    [4, 'certificate_pool_unsupported'],
    [5, 'certificate_unknown'],
    [6, 'certificate_unknown'],
    [9, 'certificate_vote_delegation_unsupported'],
    [10, 'certificate_vote_delegation_unsupported'],
    [12, 'certificate_vote_delegation_unsupported'],
    [13, 'certificate_vote_delegation_unsupported'],
    [14, 'certificate_governance_unsupported'],
    [15, 'certificate_governance_unsupported'],
    [16, 'certificate_governance_unsupported'],
    [17, 'certificate_governance_unsupported'],
    [18, 'certificate_governance_unsupported'],
    [19, 'certificate_unknown'],
    [255, 'certificate_unknown'],
    [70_000, 'certificate_unknown'],
  ])('tag %i refuses as %s, whatever follows it', (tag, code) => {
    expect(refusalOf(array(uint(tag), cred))).toEqual({ code, path: 'c', detail: `tag_${tag}` });
  });

  it('every tag from 0 to 63 is rendered or refused', () => {
    for (let tag = 0; tag < 64; tag++) {
      expect(RENDERED_CERTIFICATE_TAGS.includes(tag) !== (certificateTagRefusal(tag) !== null)).toBe(true);
    }
  });

  it('a Shelley certificate without a stake key deposit refuses', () => {
    expect(refusalOf(array(uint(0), cred), ctx(null))).toEqual({ code: 'deposit_unknown', path: 'c' });
    expect(refusalOf(array(uint(1), cred), ctx(null))).toEqual({ code: 'deposit_unknown', path: 'c' });
  });

  it.each([
    ['a registration with an amount (Shelley tag, Conway shape)', array(uint(0), cred, uint(2_000_000))],
    ['a delegation without a pool', array(uint(2), cred)],
    ['a Conway registration without an amount', array(uint(7), cred)],
    ['a registration with delegation without a deposit', array(uint(11), cred, bytes(POOL_KEY_HASH))],
    ['an empty certificate', array()],
  ])('refuses %s', (_, hex) => {
    expect(refusalOf(hex)).toMatchObject({ code: 'field_malformed', path: 'c' });
  });

  it('a pool key hash of the wrong length refuses', () => {
    expect(refusalOf(array(uint(2), cred, bytes('9a'.repeat(27))))).toEqual({ code: 'field_malformed', path: 'c.pool', detail: 'expected_28_bytes' });
  });
});

describe('decodeCertificates', () => {
  it('records a refusal per certificate and renders the rest', () => {
    const c = ctx();
    const views = decodeCertificates(fromHex(array(array(uint(2), cred, bytes(POOL_KEY_HASH)), array(uint(3)), array(uint(9), cred, array(uint(2))))), 'body.4', c);
    expect(views).toHaveLength(1);
    expect(c.refusals.list).toEqual([
      { code: 'certificate_pool_unsupported', path: 'body.4[1]', detail: 'tag_3' },
      { code: 'certificate_vote_delegation_unsupported', path: 'body.4[2]', detail: 'tag_9' },
    ]);
  });

  it('refuses an empty set and a repeated certificate', () => {
    expect(() => decodeCertificates(fromHex(array()), 'body.4', ctx())).toThrow(FieldRefusal);
    const same = array(uint(2), cred, bytes(POOL_KEY_HASH));
    expect(() => decodeCertificates(fromHex(array(same, same)), 'body.4', ctx())).toThrow(/duplicate_element/);
  });
});
