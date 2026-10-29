// The dApp-entry tripwire for programmable UTxOs the refusal index has not seen yet: a
// transfer (a withdrawal from the network's PLG script) that needs one of the wallet's keys.
import { describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { cip113TransferNeedsOwnKey } from './cip113Guard';
import { CIP113_GLOBAL_MAINNET, CIP113_GLOBAL_PREPROD } from '@/utils/cip113Deployments';
import { T3_UNSIGNED_TX, TEST_WALLET_PAYMENT_KEY_HASH, TEST_WALLET_STAKE_KEY_HASH } from './__fixtures__/cip113Preprod';

const t3 = () => Serialization.Transaction.fromCbor(HexBlob(T3_UNSIGNED_TX)).toCore();
const PREPROD_GLOBAL = new Set(CIP113_GLOBAL_PREPROD);

describe('cip113TransferNeedsOwnKey', () => {
  it("flags a transfer that needs the wallet's stake key (T3)", () => {
    expect(cip113TransferNeedsOwnKey(t3(), PREPROD_GLOBAL, new Set([TEST_WALLET_PAYMENT_KEY_HASH, TEST_WALLET_STAKE_KEY_HASH]))).toBe(true);
  });

  it("passes a transfer that needs none of the wallet's keys", () => {
    expect(cip113TransferNeedsOwnKey(t3(), PREPROD_GLOBAL, new Set(['66'.repeat(28)]))).toBe(false);
  });

  it("passes a transaction that needs the wallet's key but runs no transfer", () => {
    const tx = t3();
    tx.body.withdrawals = [];
    expect(cip113TransferNeedsOwnKey(tx, PREPROD_GLOBAL, new Set([TEST_WALLET_STAKE_KEY_HASH]))).toBe(false);
  });

  it("only knows the network's own PLG", () => {
    expect(cip113TransferNeedsOwnKey(t3(), new Set(CIP113_GLOBAL_MAINNET), new Set([TEST_WALLET_STAKE_KEY_HASH]))).toBe(false);
    expect(cip113TransferNeedsOwnKey(t3(), new Set(), new Set([TEST_WALLET_STAKE_KEY_HASH]))).toBe(false);
  });
});
