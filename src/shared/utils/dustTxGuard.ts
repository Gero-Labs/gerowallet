import { Cardano } from '@cardano-sdk/core';
import { DUST_MAPPING_VALIDATOR } from '@/shared/utils/dustMappingValidator';
import {
  MAX_COLLATERAL_AT_RISK_LOVELACE,
  verifyTxIntent,
  type TxIntent,
  type TxIntentViolation,
} from '@/shared/utils/txIntentGuard';

/**
 * Checks for the cNIGHT→DUST mapping-validator transactions Nexus builds
 * (`dust/build-registration-tx`, `-deregistration-tx`, `-update-tx`) before the
 * wallet signs them with its payment and stake keys.
 *
 * Nexus picks the inputs from the wallet's address, so the wallet does not know
 * them in advance. It bounds what can leave instead: every output pays the
 * wallet except the one mapping UTxO at the reviewed validator address (on
 * register and update), the fee is capped, collateral is bounded and returns to
 * the wallet, and nothing else is minted, certified or withdrawn. The mapping
 * datum must name the DUST address the user chose, so a builder cannot point
 * the user's cNIGHT at someone else's DUST address.
 *
 * The mapping NFT: on deregister and update it is the token the user's own
 * registration UTxO holds, which the caller proves from the transaction that
 * created it (`registrationNftUnit`, see provenInputs.ts); the burn, or the
 * token re-locked at the validator, must be exactly that one.
 *
 * Tolerances, each because the wallet has no reviewed constant to pin:
 * - the mapping NFT's policy and name on register (it mints exactly one unit,
 *   +1, into the validator output), and on deregister/update when the
 *   registration UTxO could not be proven (exactly one unit, -1 / moved);
 * - the validator output's lovelace (its min-UTxO), up to {@link DUST_VALIDATOR_OUTPUT_MAX_LOVELACE};
 * - withdrawals of 0 lovelace (the script's withdraw-zero authorization), which move no value;
 * - the inputs, which Nexus selects: every output, the fee and the collateral are
 *   bounded, so an input can only add value to what returns to the wallet.
 */

export type DustTxKind = 'register' | 'deregister' | 'update';

/** The mapping UTxO holds only its NFT and the min-UTxO lovelace that carries it. */
export const DUST_VALIDATOR_OUTPUT_MAX_LOVELACE = 5_000_000n;

export interface DustTxExpectation {
  kind: DustTxKind;
  /** The wallet's network (selects the reviewed validator). */
  network: string;
  /** The wallet's base address the build was requested for. */
  cardanoAddress: string;
  /** register / update: the DUST address bytes (hex) the user chose. */
  dustAddressHex?: string;
  /** deregister / update: `txHash#index` of the registration UTxO being spent. */
  registrationRef?: string;
  /**
   * deregister / update: the mapping NFT (`policyId + assetNameHex`) that the
   * registration UTxO holds, as proven from the transaction that created it.
   * When given, only that token may be burned or re-locked.
   */
  registrationNftUnit?: string | null;
  /** A collateral UTxO Nexus says it lends (its own risk, not the user's). */
  sponsoredCollateralRef?: string | null;
  /**
   * `txHash#index` of the UTxOs the wallet holds, when known. A "sponsored" ref
   * the wallet holds is the user's own; without this list it is treated as such.
   */
  ownUtxoRefs?: Iterable<string>;
}

export type DustTxViolation = TxIntentViolation | 'unsupported';

function plutusBytes(data: Cardano.PlutusData | undefined, into: string[]): void {
  if (data === undefined || data === null || typeof data === 'bigint') return;
  if (data instanceof Uint8Array) {
    into.push(Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(''));
    return;
  }
  const d = data as unknown as {
    items?: Cardano.PlutusData[];
    fields?: { items?: Cardano.PlutusData[] };
    data?: Map<Cardano.PlutusData, Cardano.PlutusData>;
  };
  for (const item of d.items ?? []) plutusBytes(item, into);
  for (const item of d.fields?.items ?? []) plutusBytes(item, into);
  if (d.data instanceof Map) {
    for (const [k, v] of d.data) {
      plutusBytes(k, into);
      plutusBytes(v, into);
    }
  }
}

/**
 * The datum must be inline, must carry the chosen DUST address, and may carry
 * no byte string other than that address and the wallet's own key hashes (the
 * datum's `c_wallet` stake credential). Schema-agnostic on purpose: integers
 * and constructor tags are not checked, every byte string is.
 */
function datumNamesOnly(output: Cardano.TxOut, dustAddressHex: string, ownKeyHashes: ReadonlySet<string>): boolean {
  const datum = (output as { datum?: Cardano.PlutusData }).datum;
  if (datum === undefined) return false;
  const bytes: string[] = [];
  plutusBytes(datum, bytes);
  const want = dustAddressHex.toLowerCase();
  if (!bytes.includes(want)) return false;
  return bytes.every((b) => b === want || ownKeyHashes.has(b));
}

function keyHashesOf(cardanoAddress: string): { payment: string; stake: string } | null {
  try {
    const base = Cardano.Address.fromBech32(cardanoAddress.trim()).asBase();
    if (!base) return null;
    const payment = base.getPaymentCredential();
    const stake = base.getStakeCredential();
    if (payment.type !== Cardano.CredentialType.KeyHash || stake.type !== Cardano.CredentialType.KeyHash) return null;
    return { payment: String(payment.hash).toLowerCase(), stake: String(stake.hash).toLowerCase() };
  } catch {
    return null;
  }
}

const singleUnit = (assets: ReadonlyMap<string, bigint>, quantity: bigint): string | null => {
  if (assets.size !== 1) return null;
  const [[unit, qty]] = [...assets];
  return qty === quantity ? unit : null;
};

/** The {@link TxIntent} a mapping-validator transaction of `exp.kind` must satisfy, or null when it cannot be checked. */
export function dustMappingTxIntent(tx: Cardano.Tx, exp: DustTxExpectation): TxIntent | null {
  const validator = DUST_MAPPING_VALIDATOR[exp.network];
  const keys = keyHashesOf(exp.cardanoAddress);
  if (!validator || !keys) return null;
  const ownKeyHashes = new Set([keys.payment, keys.stake]);
  const ownRefs = exp.ownUtxoRefs ? new Set(Array.from(exp.ownUtxoRefs, (r) => r.toLowerCase())) : null;
  const sponsored = exp.sponsoredCollateralRef?.toLowerCase() ?? null;
  // A ref Nexus calls sponsored counts as the sponsor's only when the wallet can
  // tell it is not one of its own UTxOs.
  const isOwnRisk = (ref: string) => !(sponsored && ref === sponsored && ownRefs && !ownRefs.has(ref));

  const mintUnit = (quantity: bigint) => {
    const mint = new Map<string, bigint>();
    for (const [unit, qty] of tx.body.mint ?? new Map()) mint.set(String(unit), BigInt(qty));
    return singleUnit(mint, quantity);
  };

  const base: TxIntent = {
    outputs: [],
    ownAddresses: [exp.cardanoAddress],
    allowZeroWithdrawals: true,
    requiredSigners: ownKeyHashes,
    collateral: { maxAtRiskLovelace: MAX_COLLATERAL_AT_RISK_LOVELACE, isOwnRisk },
  };

  const nft = exp.registrationNftUnit?.toLowerCase() ?? null;
  const isRegistrationNft = (unit: string | null) => unit !== null && (nft === null || unit.toLowerCase() === nft);

  if (exp.kind === 'deregister') {
    if (!exp.registrationRef) return null;
    return {
      ...base,
      requiredInputs: [exp.registrationRef],
      mint: (mint) => isRegistrationNft(singleUnit(mint, -1n)),
    };
  }

  if (!exp.dustAddressHex) return null;
  const dustAddressHex = exp.dustAddressHex;
  const datum = (output: Cardano.TxOut) => datumNamesOnly(output, dustAddressHex, ownKeyHashes);

  if (exp.kind === 'register') {
    const minted = mintUnit(1n);
    return {
      ...base,
      mint: (mint) => singleUnit(mint, 1n) !== null,
      boundedOutputs: [{
        address: validator.address,
        maxLovelace: DUST_VALIDATOR_OUTPUT_MAX_LOVELACE,
        // The NFT just minted, and nothing else, sits at the validator.
        assets: (assets) => minted !== null && singleUnit(assets, 1n) === minted,
        datum,
      }],
    };
  }

  if (!exp.registrationRef) return null;
  return {
    ...base,
    requiredInputs: [exp.registrationRef],
    boundedOutputs: [{
      address: validator.address,
      maxLovelace: DUST_VALIDATOR_OUTPUT_MAX_LOVELACE,
      assets: (assets) => isRegistrationNft(singleUnit(assets, 1n)),
      datum,
    }],
  };
}

/**
 * The mapping NFT a registration UTxO holds: its single non-ADA token, held
 * once, at the network's mapping validator. Null when the output is anything
 * else (then nothing is pinned from it).
 */
export function registrationNftOf(output: Cardano.TxOut | undefined, network: string): string | null {
  const validator = DUST_MAPPING_VALIDATOR[network];
  if (!output || !validator || String(output.address) !== validator.address) return null;
  const assets = new Map<string, bigint>();
  for (const [unit, qty] of output.value?.assets ?? new Map()) assets.set(String(unit), BigInt(qty));
  return singleUnit(assets, 1n);
}

/** Every way `tx` departs from the expected mapping-validator transaction; empty when it matches. */
export function verifyDustMappingTx(tx: Cardano.Tx, exp: DustTxExpectation): DustTxViolation[] {
  const intent = dustMappingTxIntent(tx, exp);
  if (!intent) return ['unsupported'];
  return verifyTxIntent(tx, intent);
}
