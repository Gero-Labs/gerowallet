// The wallet's check of the transfer Nexus built. T3 (the real MickyUSD transfer Nexus built
// and evaluated against live preprod) must pass, and one altered copy per rule must not.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  CIP113_MAX_COLLATERAL_AT_RISK,
  CIP113_MAX_FEE,
  CIP113_MAX_OUTPUT_LOVELACE,
  CIP113_MAX_VALIDITY_SLOTS,
  Cip113VerifyError,
  type Cip113VerifyContext,
  type Cip113VerifyRule,
  type Cip113TransferIntent,
  programmableAddress,
  verifyCip113Transfer,
} from './cip113VerifyTransfer';
import { applyDataParams, plutusV3Hash } from './cip113Uplc';
import { CIP113_BASE_PREPROD, CIP113_GLOBAL_PREPROD, CIP113_TRANSFER_PREPROD } from '@/utils/cip113Deployments';
import { CIP113_TRANSFER_LOGIC_TEMPLATES } from '@/utils/cip113TransferLogic';
import {
  FEE_INPUT,
  MICKY_BLACKLIST_POLICY,
  MICKY_INPUT,
  MICKY_LOGIC_HASH,
  MICKY_UNIT,
  T3_RECIPIENT_ADDRESS,
  T3_RECIPIENT_OWNER,
  T3_RECIPIENT_PLB_ADDRESS,
  T3_TX_ID,
  T3_UNSIGNED_TX,
  TEST_WALLET_BASE_ADDRESS,
  TEST_WALLET_PAYMENT_KEY_HASH,
  TEST_WALLET_PLB_ADDRESS,
  TEST_WALLET_STAKE_KEY_HASH,
} from './__fixtures__/cip113Preprod';

const PLB = CIP113_BASE_PREPROD[0];
const TESTNET = Cardano.NetworkId.Testnet;
const template = (id: string) => CIP113_TRANSFER_LOGIC_TEMPLATES.find((t) => t.moduleId === id)!;

function utxo(txId: string, index: number, address: string, coins: bigint, assets?: Record<string, bigint>): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins, ...(assets ? { assets: new Map(Object.entries(assets)) as Cardano.TokenMap } : {}) },
    },
  ] as Cardano.Utxo;
}

const MICKY_UTXO = utxo(MICKY_INPUT.txId, MICKY_INPUT.index, TEST_WALLET_PLB_ADDRESS, MICKY_INPUT.coins, { [MICKY_UNIT]: MICKY_INPUT.quantity });
const FEE_UTXO = utxo(FEE_INPUT.txId, FEE_INPUT.index, TEST_WALLET_BASE_ADDRESS, FEE_INPUT.coins);
const FEE_REF = `${FEE_INPUT.txId}#${FEE_INPUT.index}`;

function context(overrides: Partial<Cip113VerifyContext> = {}): Cip113VerifyContext {
  return {
    networkId: TESTNET,
    globalScriptHashes: new Set(CIP113_GLOBAL_PREPROD),
    transferScriptHashes: new Set(CIP113_TRANSFER_PREPROD),
    selection: {
      utxos: [MICKY_UTXO],
      address: TEST_WALLET_PLB_ADDRESS,
      baseScriptHash: PLB,
      ownerKeyHash: TEST_WALLET_STAKE_KEY_HASH,
      total: MICKY_INPUT.quantity,
    },
    ownUtxos: [FEE_UTXO],
    ownAddresses: new Set([TEST_WALLET_BASE_ADDRESS]),
    ownKeyHashes: new Set([TEST_WALLET_PAYMENT_KEY_HASH, TEST_WALLET_STAKE_KEY_HASH]),
    ...overrides,
  };
}

const INTENT: Cip113TransferIntent = { unit: MICKY_UNIT, quantity: 1_000_000n, recipientAddress: T3_RECIPIENT_ADDRESS };

/** T3 with `edit` applied, re-serialized, and its new id. */
function mutated(edit: (tx: Cardano.Tx) => void): { cbor: string; id: string } {
  const tx = Serialization.Transaction.fromCbor(HexBlob(T3_UNSIGNED_TX)).toCore();
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

function verify(tx: { cbor: string; id: string }, intent: Cip113TransferIntent = INTENT, ctx = context()) {
  return verifyCip113Transfer(tx.cbor, tx.id, intent, ctx);
}

function refusedBy(rule: Cip113VerifyRule, run: () => unknown) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(Cip113VerifyError);
    expect((e as Cip113VerifyError).rule).toBe(rule);
    return;
  }
  throw new Error(`expected a ${rule} refusal, but the transfer was accepted`);
}

const T3 = { cbor: T3_UNSIGNED_TX, id: T3_TX_ID };
const out = (tx: Cardano.Tx, i: number) => tx.body.outputs[i];
const RECIPIENT_OUT = 0;
const CHANGE_OUT = 1;
const WALLET_OUT = 2;

function keyBase(networkId: Cardano.NetworkId, payment: string, stake: { hash: string; type: Cardano.CredentialType }) {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake.hash), type: stake.type },
  ).toAddress().toBech32();
}

describe('verifyCip113Transfer: T3', () => {
  it('accepts the transfer Nexus built and evaluated on preprod, and says what it does', () => {
    expect(verify(T3)).toEqual({
      txId: T3_TX_ID,
      unit: MICKY_UNIT,
      quantity: '1000000',
      recipientAddress: T3_RECIPIENT_ADDRESS,
      recipientProgrammableAddress: T3_RECIPIENT_PLB_ADDRESS,
      recipientOwner: { type: 'stake_key', hash: T3_RECIPIENT_OWNER },
      lovelaceToRecipient: '1236970',
      changeProgrammableAddress: TEST_WALLET_PLB_ADDRESS,
      lovelaceToChange: '1236970',
      fee: '352696',
      collateralAtRisk: '529044',
      moduleId: 'freeze-and-seize',
      transferLogicHash: MICKY_LOGIC_HASH,
      validityStart: 137527637,
      validityEnd: 137528597,
    });
  });

  it('accepts T3 re-serialized unchanged, so each refusal below comes from its own edit', () => {
    expect(verify(mutated(() => undefined)).moduleId).toBe('freeze-and-seize');
  });

  it('refuses when the id differs from the one Nexus reported', () => {
    refusedBy('TX_ID', () => verifyCip113Transfer(T3_UNSIGNED_TX, 'ab'.repeat(32), INTENT, context()));
    refusedBy('TX_ID', () => verifyCip113Transfer('84a0', T3_TX_ID, INTENT, context()));
  });
});

describe('verifyCip113Transfer: envelope and body', () => {
  it('refuses a transaction marked invalid (it would forfeit collateral)', () => {
    refusedBy('ENVELOPE', () => verify(mutated((tx) => { tx.isValid = false; })));
  });

  it('refuses a missing or longer than one hour validity window', () => {
    refusedBy('ENVELOPE', () => verify(mutated((tx) => { tx.body.validityInterval = { invalidHereafter: 137528597 }; })));
    refusedBy('ENVELOPE', () => verify(mutated((tx) => {
      tx.body.validityInterval = { invalidBefore: 100, invalidHereafter: 101 + CIP113_MAX_VALIDITY_SLOTS };
    })));
  });

  it('refuses auxiliary data', () => {
    refusedBy('ENVELOPE', () => verify(mutated((tx) => { tx.body.auxiliaryDataHash = Hash32ByteBase16('00'.repeat(32)); })));
  });

  it('refuses a body for another network', () => {
    refusedBy('NETWORK', () => verify(mutated((tx) => { tx.body.networkId = Cardano.NetworkId.Mainnet; })));
  });

  it('refuses certificates, minting and treasury donations', () => {
    refusedBy('BODY', () => verify(mutated((tx) => {
      tx.body.certificates = [{
        __typename: Cardano.CertificateType.StakeRegistration,
        stakeCredential: { hash: Hash28ByteBase16(TEST_WALLET_STAKE_KEY_HASH), type: Cardano.CredentialType.KeyHash },
      }];
    })));
    refusedBy('BODY', () => verify(mutated((tx) => { tx.body.mint = new Map([[Cardano.AssetId(MICKY_UNIT), 1n]]); })));
    refusedBy('BODY', () => verify(mutated((tx) => { tx.body.donation = 1n; })));
  });
});

describe('verifyCip113Transfer: inputs', () => {
  it('refuses a transfer that spends a UTxO that is not the wallet\'s', () => {
    refusedBy('INPUTS', () => verify(mutated((tx) => {
      tx.body.inputs.push({ txId: Cardano.TransactionId('cd'.repeat(32)), index: 0 });
    })));
  });

  it('refuses a transfer that leaves out a chosen programmable UTxO', () => {
    const other = utxo('ef'.repeat(32), 1, TEST_WALLET_PLB_ADDRESS, 1_236_970n, { [MICKY_UNIT]: 5n });
    const ctx = context();
    refusedBy('INPUTS', () => verify(T3, INTENT, {
      ...ctx,
      selection: { ...ctx.selection, utxos: [MICKY_UTXO, other], total: MICKY_INPUT.quantity + 5n },
    }));
  });

  it("refuses a fee input that is not among the wallet's UTxOs", () => {
    refusedBy('INPUTS', () => verify(T3, INTENT, context({ ownUtxos: [] })));
  });
});

describe('verifyCip113Transfer: withdrawals and transfer logic', () => {
  const rewardAddress = (hash: string, type = Cardano.CredentialType.ScriptHash) =>
    Cardano.RewardAddress.fromCredentials(TESTNET, { hash: Hash28ByteBase16(hash), type }).toAddress().toBech32() as Cardano.RewardAccount;

  it('refuses a withdrawal that is not 0', () => {
    refusedBy('WITHDRAWALS', () => verify(mutated((tx) => { tx.body.withdrawals![0].quantity = 1n; })));
  });

  it('refuses a missing global withdrawal or an extra one', () => {
    refusedBy('WITHDRAWALS', () => verify(mutated((tx) => { tx.body.withdrawals = []; })));
    refusedBy('WITHDRAWALS', () => verify(mutated((tx) => {
      tx.body.withdrawals = tx.body.withdrawals!.filter((w) => w.stakeAddress !== rewardAddress(CIP113_GLOBAL_PREPROD[0]));
    })));
    refusedBy('WITHDRAWALS', () => verify(mutated((tx) => {
      tx.body.withdrawals!.push({ stakeAddress: rewardAddress('33'.repeat(28)), quantity: 0n });
    })));
  });

  it('refuses a withdrawal from a key (the wallet\'s own stake key)', () => {
    refusedBy('WITHDRAWALS', () => verify(mutated((tx) => {
      tx.body.withdrawals = tx.body.withdrawals!.map((w) => w.stakeAddress === rewardAddress(MICKY_LOGIC_HASH)
        ? { stakeAddress: rewardAddress(TEST_WALLET_STAKE_KEY_HASH, Cardano.CredentialType.KeyHash), quantity: 0n }
        : w);
    })));
  });

  function withLogic(compiledCode: Uint8Array) {
    const hash = plutusV3Hash(compiledCode);
    return mutated((tx) => {
      tx.body.withdrawals = tx.body.withdrawals!.map((w) => w.stakeAddress === rewardAddress(MICKY_LOGIC_HASH)
        ? { stakeAddress: rewardAddress(hash), quantity: 0n }
        : w);
      tx.witness.scripts = [{ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(bytesToHex(compiledCode)) }];
    });
  }

  it('accepts the dummy template as the logic', () => {
    expect(verify(withLogic(hexToBytes(template('dummy').compiledCode))).moduleId).toBe('dummy');
  });

  it("refuses freeze-and-seize applied to another deployment's PLB", () => {
    const foreign = applyDataParams(hexToBytes(template('freeze-and-seize').compiledCode), [
      hexToBytes(`d87a9f581c${'22'.repeat(28)}ff`),
      hexToBytes(`581c${MICKY_BLACKLIST_POLICY}`),
    ]);
    refusedBy('LOGIC', () => verify(withLogic(foreign)));
  });

  it('refuses logic from no reviewed template', () => {
    // A valid program that is not a template: freeze-and-seize with a third parameter.
    const extra = applyDataParams(hexToBytes(template('freeze-and-seize').compiledCode), [
      hexToBytes(`d87a9f581c${PLB}ff`),
      hexToBytes(`581c${MICKY_BLACKLIST_POLICY}`),
      hexToBytes(`581c${MICKY_BLACKLIST_POLICY}`),
    ]);
    refusedBy('LOGIC', () => verify(withLogic(extra)));
  });

  it('refuses a witness script that is not the logic withdrawn', () => {
    refusedBy('LOGIC', () => verify(mutated((tx) => {
      tx.witness.scripts = [{ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(template('dummy').compiledCode) }];
    })));
  });

  it('refuses a second witness script', () => {
    refusedBy('LOGIC', () => verify(mutated((tx) => {
      tx.witness.scripts!.push({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(template('dummy').compiledCode) });
    })));
  });
});

describe('verifyCip113Transfer: required signers', () => {
  it("refuses anything but exactly the tokens' owner", () => {
    refusedBy('SIGNERS', () => verify(mutated((tx) => { tx.body.requiredExtraSignatures = []; })));
    refusedBy('SIGNERS', () => verify(mutated((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(TEST_WALLET_PAYMENT_KEY_HASH)]; })));
    refusedBy('SIGNERS', () => verify(mutated((tx) => {
      tx.body.requiredExtraSignatures!.push(Ed25519KeyHashHex(TEST_WALLET_PAYMENT_KEY_HASH));
    })));
  });

  it('refuses an owner key the wallet does not hold', () => {
    refusedBy('SIGNERS', () => verify(T3, INTENT, context({ ownKeyHashes: new Set([TEST_WALLET_PAYMENT_KEY_HASH]) })));
  });
});

describe('verifyCip113Transfer: recipient', () => {
  it('accepts the recipient typed as its programmable address', () => {
    const summary = verify(T3, { ...INTENT, recipientAddress: T3_RECIPIENT_PLB_ADDRESS });
    expect(summary.recipientOwner).toEqual({ type: 'as_given', hash: T3_RECIPIENT_OWNER });
    expect(summary.recipientProgrammableAddress).toBe(T3_RECIPIENT_PLB_ADDRESS);
  });

  it("gives an enterprise address's tokens to its payment key", () => {
    const enterprise = Cardano.EnterpriseAddress.fromCredentials(TESTNET, {
      hash: Hash28ByteBase16(T3_RECIPIENT_OWNER), type: Cardano.CredentialType.KeyHash,
    }).toAddress().toBech32();
    expect(verify(T3, { ...INTENT, recipientAddress: enterprise }).recipientOwner).toEqual({ type: 'payment_key', hash: T3_RECIPIENT_OWNER });
  });

  it('refuses a recipient whose tokens only a script could move, or with no owner key', () => {
    const scriptStake = keyBase(TESTNET, TEST_WALLET_PAYMENT_KEY_HASH, { hash: '44'.repeat(28), type: Cardano.CredentialType.ScriptHash });
    refusedBy('RECIPIENT', () => verify(T3, { ...INTENT, recipientAddress: scriptStake }));
    const reward = Cardano.RewardAddress.fromCredentials(TESTNET, {
      hash: Hash28ByteBase16(T3_RECIPIENT_OWNER), type: Cardano.CredentialType.KeyHash,
    }).toAddress().toBech32();
    refusedBy('RECIPIENT', () => verify(T3, { ...INTENT, recipientAddress: reward }));
    refusedBy('RECIPIENT', () => verify(T3, { ...INTENT, recipientAddress: 'not an address' }));
  });

  it('refuses a recipient on another network', () => {
    const mainnet = keyBase(Cardano.NetworkId.Mainnet, TEST_WALLET_PAYMENT_KEY_HASH, { hash: T3_RECIPIENT_OWNER, type: Cardano.CredentialType.KeyHash });
    refusedBy('RECIPIENT', () => verify(T3, { ...INTENT, recipientAddress: mainnet }));
  });

  it('refuses sending to the programmable address it spends from', () => {
    refusedBy('RECIPIENT', () => verify(T3, { ...INTENT, recipientAddress: TEST_WALLET_BASE_ADDRESS }));
  });

  it('refuses a transfer that pays a different owner than the typed recipient', () => {
    const otherOwner = keyBase(TESTNET, TEST_WALLET_PAYMENT_KEY_HASH, { hash: '55'.repeat(28), type: Cardano.CredentialType.KeyHash });
    refusedBy('OUTPUTS', () => verify(T3, { ...INTENT, recipientAddress: otherOwner }));
  });
});

describe('verifyCip113Transfer: outputs', () => {
  it('refuses a different amount to the recipient', () => {
    refusedBy('OUTPUTS', () => verify(T3, { ...INTENT, quantity: 2_000_000n }));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      out(tx, RECIPIENT_OUT).value.assets = new Map([[Cardano.AssetId(MICKY_UNIT), 2_000_000n]]);
    })));
  });

  it('refuses more ADA than the cap on a programmable output', () => {
    refusedBy('OUTPUTS', () => verify(mutated((tx) => { out(tx, RECIPIENT_OUT).value.coins = CIP113_MAX_OUTPUT_LOVELACE + 1n; })));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => { out(tx, CHANGE_OUT).value.coins = CIP113_MAX_OUTPUT_LOVELACE + 1n; })));
  });

  it('refuses tokens diverted from the change', () => {
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      out(tx, CHANGE_OUT).value.assets = new Map([[Cardano.AssetId(MICKY_UNIT), 19_000_000n]]);
      out(tx, WALLET_OUT).value.assets = new Map([[Cardano.AssetId(MICKY_UNIT), 1_000_000n]]);
    })));
  });

  it('refuses an output to anyone else', () => {
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(T3_RECIPIENT_ADDRESS), value: { coins: 1_000_000n } });
    })));
  });

  it('refuses a programmable output without an inline datum, with a datum hash, a reference script or a large datum', () => {
    refusedBy('OUTPUTS', () => verify(mutated((tx) => { delete out(tx, RECIPIENT_OUT).datum; })));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      delete out(tx, RECIPIENT_OUT).datum;
      out(tx, RECIPIENT_OUT).datumHash = Hash32ByteBase16('00'.repeat(32));
    })));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      out(tx, CHANGE_OUT).scriptReference = { __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(template('dummy').compiledCode) };
    })));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => { out(tx, RECIPIENT_OUT).datum = new Uint8Array(1100); })));
  });

  it('refuses a reference script on a wallet output', () => {
    refusedBy('OUTPUTS', () => verify(mutated((tx) => {
      out(tx, WALLET_OUT).scriptReference = { __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(template('dummy').compiledCode) };
    })));
  });

  it('refuses a change output when everything was sent, and a missing one when not', () => {
    refusedBy('OUTPUTS', () => verify(T3, { ...INTENT, quantity: MICKY_INPUT.quantity }));
    refusedBy('OUTPUTS', () => verify(mutated((tx) => { tx.body.outputs.splice(CHANGE_OUT, 1); })));
  });
});

describe('verifyCip113Transfer: fee and collateral', () => {
  it('refuses a fee above the cap', () => {
    refusedBy('FEE', () => verify(mutated((tx) => { tx.body.fee = CIP113_MAX_FEE + 1n; })));
  });

  it('refuses collateral returned elsewhere, or more at risk than the cap', () => {
    refusedBy('COLLATERAL', () => verify(mutated((tx) => {
      tx.body.collateralReturn!.address = Cardano.PaymentAddress(T3_RECIPIENT_ADDRESS);
    })));
    refusedBy('COLLATERAL', () => verify(mutated((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_INPUT.coins - CIP113_MAX_COLLATERAL_AT_RISK - 1n;
      tx.body.totalCollateral = CIP113_MAX_COLLATERAL_AT_RISK + 1n;
    })));
    refusedBy('COLLATERAL', () => verify(mutated((tx) => { delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
  });

  it('refuses a total collateral that disagrees with the return', () => {
    refusedBy('COLLATERAL', () => verify(mutated((tx) => { tx.body.totalCollateral = 1n; })));
  });

  it('refuses collateral that is not the wallet\'s, unless it is the pool UTxO Nexus lent', () => {
    const poolRef = { txId: Cardano.TransactionId('aa'.repeat(32)), index: 2 };
    const pooled = mutated((tx) => {
      tx.body.collaterals = [poolRef];
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    });
    refusedBy('COLLATERAL', () => verify(pooled));
    const summary = verify(pooled, INTENT, context({ sponsoredCollateralRef: `${'aa'.repeat(32)}#2` }));
    expect(summary.collateralAtRisk).toBe('0');
    expect(summary.sponsoredCollateralRef).toBe(`${'aa'.repeat(32)}#2`);
  });

  it('refuses own collateral the transaction does not spend, and a second collateral', () => {
    const spare = utxo('bb'.repeat(32), 0, TEST_WALLET_BASE_ADDRESS, 5_000_000n);
    refusedBy('COLLATERAL', () => verify(mutated((tx) => {
      tx.body.collaterals = [{ txId: spare[0].txId, index: 0 }];
    }), INTENT, context({ ownUtxos: [FEE_UTXO, spare] })));
    refusedBy('COLLATERAL', () => verify(mutated((tx) => {
      tx.body.collaterals!.push({ txId: spare[0].txId, index: 0 });
    }), INTENT, context({ ownUtxos: [FEE_UTXO, spare] })));
  });

  it('accepts the fee input as collateral exactly as T3 has it', () => {
    expect(verify(T3).collateralAtRisk).toBe('529044');
    expect(FEE_REF).toBe(`${FEE_INPUT.txId}#0`);
  });
});

describe('programmableAddress', () => {
  it("builds the test wallet's programmable address from its stake key", () => {
    expect(programmableAddress(PLB, TEST_WALLET_STAKE_KEY_HASH, TESTNET)).toBe(TEST_WALLET_PLB_ADDRESS);
  });
});
