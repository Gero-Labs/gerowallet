import { describe, expect, it } from 'vitest';
import { TESTNET_WALLET_ADDRESS, WALLET_ADDRESS } from '@/shared/utils/__fixtures__/handAssembledTxs';
import { decodeAddressBytes, decodeCredential, decodeRewardAccountBytes } from './address';
import { fromHex } from './cbor';
import { FieldRefusal } from './refusals';
import {
  array, bytes, BYRON_ADDRESS, EXECUTOR_ENTERPRISE_ADDRESS, POINTER_ADDRESS, SCRIPT_ENTERPRISE_ADDRESS, uint, VAULT_ADDRESS,
  VAULT_FOREIGN_STAKE_ADDRESS, VAULT_REWARD_ACCOUNT, VAULT_SCRIPT_HASH,
} from './__fixtures__/vaultTxs';

const refusalOf = (read: () => unknown) => {
  try {
    read();
  } catch (e) {
    if (e instanceof FieldRefusal) return e.refusal;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('decodeAddressBytes', () => {
  it('renders a base key address in full, matching a known bech32 vector', () => {
    const testnet = decodeAddressBytes(fromHex(`00${'11'.repeat(28)}${'22'.repeat(28)}`), 'a', 0);
    expect(testnet).toEqual({
      bech32: TESTNET_WALLET_ADDRESS,
      hex: `00${'11'.repeat(28)}${'22'.repeat(28)}`,
      kind: 'base',
      networkId: 0,
      payment: { kind: 'key', hash: '11'.repeat(28) },
      stake: { kind: 'key', hash: '22'.repeat(28) },
    });
    expect(decodeAddressBytes(fromHex(`01${'11'.repeat(28)}${'22'.repeat(28)}`), 'a', 1).bech32).toBe(WALLET_ADDRESS);
  });

  it('renders script payment and script stake parts (a vault)', () => {
    expect(decodeAddressBytes(fromHex(VAULT_ADDRESS), 'a', 0)).toMatchObject({
      kind: 'base',
      payment: { kind: 'script', hash: VAULT_SCRIPT_HASH },
      stake: { kind: 'script', hash: VAULT_SCRIPT_HASH },
    });
    expect(decodeAddressBytes(fromHex(VAULT_FOREIGN_STAKE_ADDRESS), 'a', 0)).toMatchObject({
      payment: { kind: 'script', hash: VAULT_SCRIPT_HASH },
      stake: { kind: 'key', hash: 'f1'.repeat(28) },
    });
  });

  it('renders enterprise addresses, key and script, with no stake part', () => {
    expect(decodeAddressBytes(fromHex(EXECUTOR_ENTERPRISE_ADDRESS), 'a', 0)).toMatchObject({ kind: 'enterprise', payment: { kind: 'key' }, stake: null });
    const script = decodeAddressBytes(fromHex(SCRIPT_ENTERPRISE_ADDRESS), 'a', 0);
    expect(script).toMatchObject({ kind: 'enterprise', payment: { kind: 'script', hash: 'cc'.repeat(28) }, stake: null });
    expect(script.bech32.startsWith('addr_test1')).toBe(true);
  });

  it.each([
    ['Byron', BYRON_ADDRESS, { code: 'address_byron_unsupported', path: 'a' }],
    ['pointer', POINTER_ADDRESS, { code: 'address_pointer_unsupported', path: 'a' }],
    ['reward account', VAULT_REWARD_ACCOUNT, { code: 'address_invalid', path: 'a', detail: 'reward_account' }],
    ['header type 9', `90${'11'.repeat(28)}`, { code: 'address_invalid', path: 'a', detail: 'header_type_9' }],
    ['a short base address', `00${'11'.repeat(28)}`, { code: 'address_invalid', path: 'a', detail: 'length' }],
    ['a long enterprise address', `60${'11'.repeat(29)}`, { code: 'address_invalid', path: 'a', detail: 'length' }],
    ['no bytes', '', { code: 'address_invalid', path: 'a', detail: 'empty' }],
    ['another network', `01${'11'.repeat(28)}${'22'.repeat(28)}`, { code: 'network_mismatch', path: 'a', detail: 'network_1' }],
  ])('refuses %s', (_, hex, refusal) => {
    expect(refusalOf(() => decodeAddressBytes(fromHex(hex), 'a', 0))).toEqual(refusal);
  });
});

describe('decodeRewardAccountBytes', () => {
  it('renders a script reward account in full', () => {
    const view = decodeRewardAccountBytes(fromHex(VAULT_REWARD_ACCOUNT), 'w', 0);
    expect(view).toMatchObject({ hex: VAULT_REWARD_ACCOUNT, networkId: 0, credential: { kind: 'script', hash: VAULT_SCRIPT_HASH } });
    expect(view.bech32.startsWith('stake_test1')).toBe(true);
  });

  it('refuses a payment address and another network', () => {
    expect(refusalOf(() => decodeRewardAccountBytes(fromHex(EXECUTOR_ENTERPRISE_ADDRESS), 'w', 0))).toEqual({ code: 'address_invalid', path: 'w', detail: 'not_reward_account' });
    expect(refusalOf(() => decodeRewardAccountBytes(fromHex(`e1${'11'.repeat(28)}`), 'w', 0))).toEqual({ code: 'network_mismatch', path: 'w', detail: 'network_1' });
  });
});

describe('decodeCredential', () => {
  it('reads key and script credentials and refuses another tag', () => {
    expect(decodeCredential(fromHex(array(uint(0), bytes('ab'.repeat(28)))), 'c')).toEqual({ kind: 'key', hash: 'ab'.repeat(28) });
    expect(decodeCredential(fromHex(array(uint(1), bytes('ab'.repeat(28)))), 'c')).toEqual({ kind: 'script', hash: 'ab'.repeat(28) });
    expect(refusalOf(() => decodeCredential(fromHex(array(uint(2), bytes('ab'.repeat(28)))), 'c'))).toEqual({ code: 'variant_unknown', path: 'c', detail: 'credential_2' });
    expect(refusalOf(() => decodeCredential(fromHex(array(uint(0), bytes('ab'.repeat(27)))), 'c'))).toEqual({ code: 'field_malformed', path: 'c', detail: 'expected_28_bytes' });
  });
});
