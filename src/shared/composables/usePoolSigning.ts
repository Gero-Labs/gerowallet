import { ref, toRefs, computed, Ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { minFee as minFeeSDK } from '@cardano-sdk/tx-construction';
import type { Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { serializeCardanoJsSdkTx, BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { assertOwnerModeShape } from '@/shared/utils/poolOwnerModeGuard';
import { validateAssembledUpdate } from '@/shared/utils/poolUpdateValidation';
import { useHotFeeKey } from './useHotFeeKey';
import networks from '@/utils/networks';
import blockchainApi from '@/api/blockchain-api';
import hardwareLoading from '@/plugins/hardwareLoading';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { debugLog } from '@/utils/debug';
import { useTranslation } from './useTranslation';

export type PoolSigningPhase =
  | 'idle'
  | 'funding'
  | 'awaitingFund'
  | 'signingOwner'
  | 'signingCold'
  | 'assembling'
  | 'readyToSubmit'
  | 'submitting'
  | 'sweeping'
  | 'done';

/** Merge the three vkey witnesses of a Ledger pool-update tx into one signatures map. */
export function assembleWitnesses(
  ownerSignatures: Cardano.Signatures,
  cold: { vkey: string; signature: string },
  fee: { vkey: string; signature: string },
): Cardano.Signatures {
  const sigs = new Map(ownerSignatures);
  sigs.set(cold.vkey as unknown as Cardano.Ed25519PublicKeyHex, cold.signature as unknown as Cardano.Ed25519SignatureHex);
  sigs.set(fee.vkey as unknown as Cardano.Ed25519PublicKeyHex, fee.signature as unknown as Cardano.Ed25519SignatureHex);
  return sigs;
}

// The Ledger pool-update tx (tx2) is always witnessed by exactly 3 keys:
// the Ledger owner (stake), the software cold key, and the software hot fee key.
const POOL_UPDATE_WITNESS_COUNT = 3;
// The sweep tx (tx3) is a plain send signed only by the hot fee key.
const SWEEP_WITNESS_COUNT = 1;
// Cushion added on top of the exact fee estimate to absorb small CBOR-size
// drift between the draft (used to size the fund amount / draft fee) and the
// final signed tx. Not a correctness requirement, just headroom.
const FEE_SAFETY_MARGIN_BYTES = BigInt(40);
const FUND_SAFETY_MARGIN = BigInt(300_000); // ~0.3 ADA cushion on top of fee + min-ADA

function protocolParamsFrom(epochParams: Cardano.ProtocolParameters) {
  return {
    coinsPerUtxoByte: epochParams.coinsPerUtxoByte,
    maxTxSize: epochParams.maxTxSize,
    maxValueSize: epochParams.maxValueSize,
    minFeeCoefficient: epochParams.minFeeCoefficient,
    minFeeConstant: epochParams.minFeeConstant,
    prices: epochParams.prices,
    minFeeRefScriptCostPerByte: epochParams.minFeeRefScriptCostPerByte,
  };
}

/**
 * Fee for a tx that will carry exactly `witnessCount` vkey witnesses.
 * Mirrors `BrowserTxConstruction.minFee`'s dummy-witness sizing technique, but
 * with an EXACT count instead of its generic cert/withdrawal heuristic (which
 * would under-count our owner+cold+fee 3-witness pool-update tx as 2).
 */
function estimateFeeForWitnessCount(
  tx: Cardano.Tx,
  resolvedInputs: Cardano.Utxo[],
  protocolParams: ReturnType<typeof protocolParamsFrom>,
  witnessCount: number,
): bigint {
  const dummySignatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();
  for (let i = 0; i < witnessCount; i++) {
    const keyPrefix = i.toString(16).padStart(2, '0');
    const dummyVKey = (keyPrefix + '0'.repeat(62)) as Ed25519PublicKeyHex;
    dummySignatures.set(dummyVKey, ('0'.repeat(128)) as Ed25519SignatureHex);
  }
  const txWithDummy: Cardano.Tx = { ...tx, witness: { ...tx.witness, signatures: dummySignatures } };
  const baseFee = minFeeSDK(txWithDummy, resolvedInputs, protocolParams);
  return baseFee + FEE_SAFETY_MARGIN_BYTES * BigInt(protocolParams.minFeeCoefficient);
}

/**
 * Build a tx spending a single hot-key UTxO in full: an optional certificate,
 * plus one output to `destinationAddress` carrying the entire remaining
 * balance (change-style, "send max"). Used for both the pool-update tx
 * (cert + change back to the hot key, 3 witnesses) and the final sweep (no
 * cert, output to the Ledger, 1 witness). No coin selection is needed — there
 * is always exactly one input — so this computes the exact fee directly
 * rather than going through the generic `buildCardanoTransaction` selector.
 */
function buildHotKeyTx(
  hotUtxo: Cardano.Utxo,
  destinationAddress: string,
  certificate: Cardano.PoolRegistrationCertificate | undefined,
  witnessCount: number,
  epochParams: Cardano.ProtocolParameters,
  tip: { slot: number | Cardano.Slot },
): Cardano.Tx {
  const protocolParams = protocolParamsFrom(epochParams);
  const validityInterval = { invalidHereafter: Cardano.Slot(Number(tip.slot) + 3600) };
  const [hotTxIn, hotTxOut] = hotUtxo;

  const buildBody = (fee: bigint): Cardano.TxBody => {
    const changeCoins = hotTxOut.value.coins - fee;
    const body: Cardano.TxBody = {
      inputs: [{ txId: hotTxIn.txId, index: hotTxIn.index }],
      outputs: [{
        address: destinationAddress as Cardano.PaymentAddress,
        value: { coins: changeCoins > BigInt(0) ? changeCoins : BigInt(0), assets: new Map() },
      }],
      fee,
      validityInterval,
    };
    if (certificate) body.certificates = [certificate];
    return body;
  };

  const draftTx: Cardano.Tx = {
    id: Cardano.TransactionId('0'.repeat(64)),
    body: buildBody(BigInt(0)),
    witness: { signatures: new Map() },
  };
  const fee = estimateFeeForWitnessCount(draftTx, [hotUtxo], protocolParams, witnessCount);

  const changeCoins = hotTxOut.value.coins - fee;
  if (changeCoins < BigInt(0)) {
    throw new Error('Hot key balance cannot cover the required fee');
  }

  const minAda = BrowserTxConstruction.minAdaRequired(
    { address: destinationAddress as Cardano.PaymentAddress, value: { coins: changeCoins, assets: new Map() } },
    epochParams.coinsPerUtxoByte,
  );
  if (changeCoins < minAda) {
    throw new Error('Hot key balance is below the minimum ADA required for the output');
  }

  return {
    id: Cardano.TransactionId('0'.repeat(64)),
    body: buildBody(fee),
    witness: { signatures: new Map() },
  };
}

/**
 * How much to fund the ephemeral hot key with: the exact fee for the real
 * pool-update certificate (sized via a dummy self-addressed UTxO, so relays/
 * metadata size are accounted for) + the min-ADA floor for its own change
 * output + a small cushion. Computed from protocol params — never hardcoded.
 */
function computeHotKeyFundAmount(
  certificate: Cardano.PoolRegistrationCertificate,
  hotAddress: string,
  epochParams: Cardano.ProtocolParameters,
  tip: { slot: number | Cardano.Slot },
): bigint {
  const dummyUtxo: Cardano.Utxo = [
    { txId: Cardano.TransactionId('0'.repeat(64)), index: 0, address: hotAddress as Cardano.PaymentAddress },
    { address: hotAddress as Cardano.PaymentAddress, value: { coins: BigInt(20_000_000), assets: new Map() } },
  ];
  const draft = buildHotKeyTx(dummyUtxo, hotAddress, certificate, POOL_UPDATE_WITNESS_COUNT, epochParams, tip);
  const fee = draft.body.fee;
  const minAda = BrowserTxConstruction.minAdaRequired(draft.body.outputs[0], epochParams.coinsPerUtxoByte);
  return fee + minAda + FUND_SAFETY_MARGIN;
}

/**
 * Composable for handling pool operator transaction signing.
 *
 * Pool operator transactions require both wallet keys (payment + stake)
 * and the cold key. This composable handles:
 * - Software cold key: sends SIGN_TX_WITH_POOL_KEYS message to background
 * - Ledger wallet: a 2-tx orchestration (fund the ephemeral hot fee key from
 *   the Ledger, then owner-mode-sign the pool-update tx)
 */
export function usePoolSigning(options: {
  tx: Ref<Cardano.Tx | undefined | null>;
  successMessageKey: string;
  onSuccess?: (txId: string) => void;
}) {
  const { t } = useTranslation();
  const { loggedWallet, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const loading = ref(false);
  const spendingPassword = ref('');
  const passwordRules = ref([rules.required()]);
  const valid = ref(false);
  const txCbor = ref('');
  const txWitnesses = ref<string | null>(null);
  const coldKeyWitness = ref<{ vkey: string; signature: string } | null>(null);
  const isSubmit = ref(false);
  const privateKeyBytes = ref<Uint8Array | null>(null);

  // Ledger-orchestration-only state (Task 6 dialog consumes these).
  const phase = ref<PoolSigningPhase>('idle');
  const assembledTx = ref<string | null>(null);
  const fundTxId = ref<string | null>(null);

  // Fund/sweep tracking for the ephemeral hot key. `funded` flips true once
  // tx1 (the Ledger → hot key fund tx) is submitted, i.e. real ADA may be
  // sitting on the hot address. `swept` flips true only once a sweep tx has
  // itself been submitted successfully. The hot key must NEVER be reset while
  // `funded && !swept` — that would strand the funds permanently (the key is
  // never persisted and cannot be re-derived). `strandedFunds` is set when a
  // sweep attempt fails so the dialog can surface it and offer `retrySweep()`.
  const funded = ref(false);
  const swept = ref(false);
  const strandedFunds = ref<{ address: string; fundTxId: string } | null>(null);
  // Internal (non-reactive) bookkeeping: the UTxO that currently holds the hot
  // key's funds. Starts as tx1's own output; once tx2 (the pool-update tx)
  // lands, its change output becomes the new holder. Not exposed — only the
  // sweep helpers below need it.
  let hotAddressState: string | null = null;
  let hotFundsUtxo: Cardano.Utxo | null = null;
  // Captured when tx2 (the pool update) lands but the follow-up sweep fails.
  // `options.onSuccess` — which drives the parent to close the dialog via its
  // v-model watcher, bypassing the dialog's own guarded `close()` — must NOT
  // fire while funds are stranded. Instead the txId is held here until a
  // later `retrySweep()` actually clears `strandedFunds`, at which point the
  // deferred `onSuccess` finally runs.
  let pendingSuccessTxId: string | null = null;

  const isPrfWallet = computed(() => loggedWallet.value?.encryptionMethod === 'prf');
  const isLedgerColdKey = computed(() => poolOperatorStore.coldKeySource === 'ledger');
  // The gate for THIS flow: the wallet itself is a Ledger (owner mode, software
  // cold key + ephemeral hot fee key). Distinct from `isLedgerColdKey`, which
  // is about the cold key living on its own separate hardware device.
  const isLedgerWallet = computed(() => loggedWallet.value?.type === WalletType.Ledger);

  const hotFeeKeyNetworkId = computed(() => {
    const id = networks.resolveNetworkId(loggedWallet.value?.chain, loggedWallet.value?.network);
    return (id === 1 ? 1 : 0) as 0 | 1;
  });
  // One instance per composable instance (one dialog open == one throwaway key).
  const hotFeeKey = useHotFeeKey(hotFeeKeyNetworkId.value);

  // Address the hot key's leftover funds get swept back to on completion/abort.
  // Must be a payment (enterprise/base) address — a reward (stake1…) address
  // cannot receive a tx output, so there is no safe fallback: fail loudly
  // instead of building a sweep tx that would only fail on submission.
  const hotFeeKeySweepAddress = computed(() => {
    const address = keys.value?.payment?.[0]?.address;
    if (!address) {
      throw new Error('No payment address available to sweep the temporary fee funds to');
    }
    return address;
  });

  /**
   * Sweep whatever the hot key currently holds (`hotFundsUtxo`) back to the
   * wallet's own address. Shared by the success-path sweep (tx3, from
   * `submitLedgerTx`) and the abort/retry recovery sweep (from `resetState` /
   * `retrySweep`). Never throws — returns false on any failure so callers can
   * decide it is NOT safe to drop the hot key yet.
   */
  const doSweep = async (): Promise<boolean> => {
    if (!hotFundsUtxo || !epochParams.value || !tip.value) return false;
    try {
      const sweepTx = buildHotKeyTx(
        hotFundsUtxo,
        hotFeeKeySweepAddress.value,
        undefined,
        SWEEP_WITNESS_COUNT,
        epochParams.value,
        tip.value,
      );
      const sweepBodyHashHex = Serialization.TransactionBody.fromCore(sweepTx.body).hash() as unknown as string;
      const sweepFeeWitness = hotFeeKey.signBodyHash(sweepBodyHashHex);
      const sweepSignatures: Cardano.Signatures = new Map([
        [sweepFeeWitness.vkey as unknown as Cardano.Ed25519PublicKeyHex, sweepFeeWitness.signature as unknown as Cardano.Ed25519SignatureHex],
      ]);
      const sweepWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures: sweepSignatures });
      const sweepResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: serializeCardanoJsSdkTx(sweepTx),
          witnessHex: sweepWitnessSet.toCbor(),
          utxos: [],
        },
      })) as { data: { error?: string } };
      if (sweepResult.data.error) {
        debugLog('[usePoolSigning] sweep failed:', sweepResult.data.error);
        return false;
      }
      swept.value = true;
      hotFundsUtxo = null;
      return true;
    } catch (sweepError) {
      debugLog('[usePoolSigning] sweep step threw:', sweepError);
      return false;
    }
  };

  /**
   * Record that the hot key still holds funds after a failed sweep attempt.
   * The key is deliberately KEPT LIVE in memory (never reset here) so
   * `retrySweep()` can try again later in this session. These funds are
   * recoverable ONLY while the key is held this session — once it is dropped
   * (or the browser/extension session ends) they are permanently unrecoverable:
   * the key is never persisted and cannot be re-derived from the wallet seed.
   */
  const markStranded = (): void => {
    if (hotAddressState && fundTxId.value) {
      strandedFunds.value = { address: hotAddressState, fundTxId: fundTxId.value };
    }
    console.warn(
      '[usePoolSigning] Hot fee key still holds funds after a failed sweep attempt. ' +
      'Keeping the key in memory for this session so retrySweep() can try again. ' +
      'These funds are recoverable ONLY while this session keeps the key in memory — ' +
      'they are NOT recoverable via the fund tx id once the key is dropped or the session ends.',
    );
  };

  /**
   * UI-triggered retry of the recovery sweep after a previous attempt left
   * `strandedFunds` set. No-op if there is nothing actually stranded.
   */
  const retrySweep = async (): Promise<void> => {
    if (!funded.value || swept.value || !hotFundsUtxo) return;
    loading.value = true;
    try {
      const ok = await doSweep();
      if (ok) {
        hotFeeKey.reset();
        strandedFunds.value = null;
        funded.value = false;
        fundTxId.value = null;
        // The pool update already succeeded (tx2 landed) and was waiting on
        // this sweep before the dialog could report success upstream — now
        // that the sweep has actually cleared, fire the deferred onSuccess.
        if (pendingSuccessTxId) {
          const deferredTxId = pendingSuccessTxId;
          pendingSuccessTxId = null;
          if (options.onSuccess) options.onSuccess(deferredTxId);
        }
      } else {
        markStranded();
      }
    } finally {
      loading.value = false;
    }
  };

  /**
   * Run the full Ledger pool-update orchestration:
   * fund (Ledger tap #1) → await hot UTxO → build tx2 (input/change on the hot
   * key) → owner-mode assert → owner witness (Ledger tap #2) → cold witness →
   * fee witness → assemble → validate. Stops at phase 'readyToSubmit' — the
   * caller (dialog) does an explicit, separate submit (see `submitLedgerTx`).
   */
  const runLedgerFlow = async (): Promise<void> => {
    loading.value = true;
    // Dynamic import: the Ledger SDK chain (@cardano-sdk/hardware-ledger →
    // @cardano-foundation/ledgerjs-hw-app-cardano) is only needed for this
    // device-driven path. Keeping it out of this module's static import graph
    // means importing `assembleWitnesses` for a unit test never touches it.
    const { default: ledgerUtils } = await import('@/shared/utils/ledger');
    try {
      const originalTx = options.tx.value;
      if (!originalTx) throw new Error(t('common.noTransactionToSign'));

      const certificate = originalTx.body.certificates?.[0] as Cardano.PoolRegistrationCertificate | undefined;
      if (!certificate || certificate.__typename !== Cardano.CertificateType.PoolRegistration) {
        throw new Error('Expected a single pool registration certificate');
      }
      if (!epochParams.value || !tip.value) throw new Error(t('errors.networkError'));
      if (!loggedWallet.value) throw new Error(t('common.noTransactionToSign'));

      const isUsb = true; // BT toggle lives on the dialog (Task 6); default to USB here.
      const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);

      // Re-entry guard: a previous run may have funded a hot key that was
      // never swept (e.g. cold-sign failed after tx1 landed). Regenerating now
      // would wipe that key (generate() zeroes the old one) and permanently
      // strand the real ADA already on the old hot address. Recover it first.
      if (funded.value && !swept.value) {
        const recovered = await doSweep();
        if (!recovered) {
          markStranded();
          loading.value = false;
          throw new Error(t('poolOperator.ledgerStrandedBody'));
        }
        // Recovered: clear the spent key + flags so we start the retry clean.
        hotFeeKey.reset();
        funded.value = false;
        swept.value = false;
        strandedFunds.value = null;
        fundTxId.value = null;
        hotFundsUtxo = null;
      }

      // --- Tx 1: fund the ephemeral hot key from the Ledger (ordinary mode) ---
      phase.value = 'funding';
      const { enterpriseAddress: hotAddress } = await hotFeeKey.generate();
      hotAddressState = hotAddress;

      const fundAmount = computeHotKeyFundAmount(certificate, hotAddress, epochParams.value, tip.value);

      hardwareLoading.setText(t('wallet.ledgerPreparingTransaction') as string);
      const fundTx = await buildCardanoTransaction({
        outputs: [{
          address: hotAddress as Cardano.PaymentAddress,
          value: { coins: fundAmount, assets: new Map() },
        }],
        utxos: utxos.value as Cardano.Utxo[],
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value.stakeAddress || '',
          accountIndex: 0,
        },
      });

      const fundSignatures = await ledgerUtils.txToLedger(fundTx, keys.value, utxos.value as Cardano.Utxo[], isUsb, network);
      const fundWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures: fundSignatures });
      const fundTxCbor = serializeCardanoJsSdkTx(fundTx);

      const fundSubmitResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: fundTxCbor,
          witnessHex: fundWitnessSet.toCbor(),
          utxos: utxos.value,
        },
      })) as { data: { txId?: string; error?: string } };
      if (fundSubmitResult.data.error) throw new Error(fundSubmitResult.data.error);
      fundTxId.value = fundSubmitResult.data.txId || null;
      if (!fundTxId.value) throw new Error('Fund transaction did not return a transaction id');

      // The hot UTxO is deterministically the fund tx's own explicit output
      // (index 0 — `buildCardanoTransaction` always places requested outputs
      // before its change output). No chain query needed to find it.
      const hotOutputIndex = fundTx.body.outputs.findIndex(
        (o) => o.address === (hotAddress as Cardano.PaymentAddress),
      );
      if (hotOutputIndex === -1) throw new Error('Could not locate the hot-key output in the fund transaction');
      const hotUtxo: Cardano.Utxo = [
        { txId: Cardano.TransactionId(fundTxId.value), index: hotOutputIndex, address: hotAddress as Cardano.PaymentAddress },
        fundTx.body.outputs[hotOutputIndex],
      ];
      // Real ADA now sits on the hot address — from this point the hot key
      // must never be reset without a confirmed sweep (see `resetState`/
      // `doSweep`/`retrySweep`).
      funded.value = true;
      hotFundsUtxo = hotUtxo;

      // --- await confirmation ---
      // TODO(infra): this is a fixed wait, not a real confirmation poll — there
      // is no existing client-side lookup for an arbitrary (non-wallet) address's
      // UTxOs in this codebase. The hot UTxO's shape is already known exactly
      // (constructed above from our own fund-tx build), so this wait only
      // guards against submitting tx2 before tx1 has propagated. Not device-gated.
      phase.value = 'awaitingFund';
      await new Promise((resolve) => setTimeout(resolve, 20_000));

      // --- Tx 2: pool update, input/change bound to the hot key ---
      const tx2 = buildHotKeyTx(hotUtxo, hotAddress, certificate, POOL_UPDATE_WITNESS_COUNT, epochParams.value, tip.value);

      const ledgerAddresses = new Set<string>([
        ...keys.value.payment.map((k) => k.address),
        ...keys.value.change.map((k) => k.address),
        ...keys.value.stake.map((k) => k.address),
      ].filter(Boolean) as string[]);
      assertOwnerModeShape(tx2, ledgerAddresses, [hotAddress]);

      // --- Ledger tap #2: owner witness ---
      phase.value = 'signingOwner';
      const ownerSignatures = await ledgerUtils.poolOwnerWitness(tx2, keys.value, utxos.value as Cardano.Utxo[], isUsb, network);

      // --- cold witness (background, cold-key-only) ---
      phase.value = 'signingCold';
      const tx2Cbor = serializeCardanoJsSdkTx(tx2);
      const coldResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX_WITH_POOL_KEYS,
        data: {
          txCbor: tx2Cbor,
          password: spendingPassword.value,
          accountIndex: 0,
          coldKeyOnly: true,
        },
      })) as { data: { coldKeyWitness?: { vkey: string; signature: string }; error?: string } };
      if (coldResult.data.error) throw new Error(coldResult.data.error);
      const cold = coldResult.data.coldKeyWitness;
      if (!cold) throw new Error('Background did not return a cold-key witness');

      // --- fee witness (in-memory hot key) ---
      const bodyHashHex = Serialization.TransactionBody.fromCore(tx2.body).hash() as unknown as string;
      const fee = hotFeeKey.signBodyHash(bodyHashHex);

      // --- assemble + validate ---
      phase.value = 'assembling';
      const signatures = assembleWitnesses(ownerSignatures, cold, fee);
      const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });

      const pool = await blockchainApi.getPoolById(
        poolOperatorStore.poolId || '',
        loggedWallet.value.chain,
        loggedWallet.value.network,
      );
      // This is a hard safety gate: the VRF check only means something if
      // `expectedVrf` comes from the chain. If the on-chain value can't be
      // fetched, we must NOT fall back to the certificate's own VRF — that
      // would compare the cert to itself and always pass, silently defeating
      // the guard against a wrong/rotated VRF key.
      const onChainVrf = pool?.vrf_key_hash as string | undefined;
      if (!onChainVrf) {
        throw new Error(
          "Could not fetch the pool's on-chain VRF key hash to verify the update — aborting for safety.",
        );
      }
      const validation = validateAssembledUpdate({
        witnessCount: signatures.size,
        expectedWitnessCount: POOL_UPDATE_WITNESS_COUNT,
        vrf: certificate.poolParameters.vrf as unknown as string,
        expectedVrf: onChainVrf,
        owners: certificate.poolParameters.owners as unknown as string[],
        expectedOwners: [loggedWallet.value.stakeAddress || ''],
      });
      if (!validation.ok) throw new Error(validation.reason || 'Assembled transaction failed validation');

      txCbor.value = tx2Cbor;
      txWitnesses.value = witnessSet.toCbor();

      const displayTx = Serialization.Transaction.fromCbor(HexBlob(tx2Cbor));
      displayTx.setWitnessSet(witnessSet);
      assembledTx.value = displayTx.toCbor();

      phase.value = 'readyToSubmit';
    } catch (e: unknown) {
      console.error('Error running Ledger pool-update flow:', e);
      ledgerUtils.ledgerErrorHandling(e);
      phase.value = 'idle';
    } finally {
      loading.value = false;
      hardwareLoading.setLoading(false);
    }
  };

  /**
   * Explicit submit for the Ledger flow (separate from the generic
   * `submitTx`): submits the assembled tx, then software-sweeps whatever
   * remains on the hot key back to the Ledger, then drops the hot key.
   */
  const submitLedgerTx = async (): Promise<void> => {
    loading.value = true;
    try {
      phase.value = 'submitting';
      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor.value,
          witnessHex: txWitnesses.value,
          utxos: utxos.value,
        },
      })) as { data: { txId?: string; error?: string } };
      if (result.data.error) throw new Error(result.data.error);

      const txId = result.data.txId || '';

      // --- Tx 3: sweep the hot key's change back to the wallet (no tap) ---
      phase.value = 'sweeping';
      if (fundTxId.value) {
        // `buildHotKeyTx` always emits exactly one output (its change/
        // destination output), so the hot key's leftover after tx2 is always
        // index 0. tx2's change output is now what the hot key holds — tx1's
        // output was just consumed as tx2's input.
        const tx2Body = Serialization.Transaction.fromCbor(HexBlob(txCbor.value)).body().toCore();
        const hotChangeOutput = tx2Body.outputs[0];
        hotFundsUtxo = [
          { txId: Cardano.TransactionId(txId), index: 0, address: hotChangeOutput.address },
          hotChangeOutput,
        ];

        const sweptOk = await doSweep();
        if (sweptOk) {
          hotFeeKey.reset();
          funded.value = false;
          strandedFunds.value = null;
          fundTxId.value = null;
        } else {
          // The pool update itself succeeded (tx2 already landed) — only the
          // leftover-sweep failed. Do NOT reset the hot key: keep it live so
          // `retrySweep()` can recover the change within this session.
          markStranded();
        }
      }

      phase.value = 'done';
      // The pool update (tx2) landed either way, so reflect that in the UI
      // regardless of whether the leftover-sweep succeeded.
      isSubmit.value = true;
      snackbar.fireSuccess(t(options.successMessageKey));
      if (strandedFunds.value) {
        // Sweep failed — funds are stranded on the hot key. Do NOT call
        // onSuccess yet: that would let the parent close the dialog via its
        // v-model watcher and bypass the guarded close() that shows the
        // Retry-sweep UI, silently losing the hot-key funds. Defer onSuccess
        // until a later retrySweep() actually clears strandedFunds.
        pendingSuccessTxId = txId || null;
      } else if (options.onSuccess && txId) {
        options.onSuccess(txId);
      }
    } catch (e: unknown) {
      console.error('Error submitting Ledger pool-update transaction:', e);
      snackbar.setError(getErrorMessage(e, t('errors.unknownError') as string));
      phase.value = 'readyToSubmit';
    } finally {
      loading.value = false;
    }
  };

  /**
   * Sign the pool operator transaction (software cold-key path).
   */
  const signTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) throw new Error(t('common.noTransactionToSign'));

      // Serialize transaction to CBOR
      txCbor.value = serializeCardanoJsSdkTx(tx);

      // Software cold key: sign with wallet keys + cold key in one background call
      const signingData: {
        txCbor: string;
        password: string;
        accountIndex: number;
        utxos: unknown;
        addresses: unknown;
        privateKeyBytes?: number[];
      } = {
        txCbor: txCbor.value,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
      };

      if (isPrfWallet.value && privateKeyBytes.value) {
        signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
      }

      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX_WITH_POOL_KEYS,
        data: signingData,
      })) as { data: { witnesses?: string; coldKeyWitness?: { vkey: string; signature: string }; error?: string } };

      if (result.data.error) {
        throw new Error(result.data.error);
      }

      txWitnesses.value = result.data.witnesses || null;
      coldKeyWitness.value = result.data.coldKeyWitness || null;
      return true;
    } catch (e: unknown) {
      console.error('Error signing pool operator transaction:', e);
      snackbar.setError(getErrorMessage(e, t('errors.unknownError') as string));
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Submit the signed transaction
   */
  const submitTx = async (): Promise<void> => {
    loading.value = true;
    try {
      // Submit via background
      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor.value,
          witnessHex: txWitnesses.value,
          coldKeyWitness: coldKeyWitness.value,
          utxos: utxos.value,
        },
      })) as { data: { txId?: string; error?: string } };

      if (result.data.error) {
        throw new Error(result.data.error);
      }

      isSubmit.value = true;
      snackbar.fireSuccess(t(options.successMessageKey));

      if (options.onSuccess && result.data.txId) {
        options.onSuccess(result.data.txId);
      }
    } catch (e: unknown) {
      console.error('Error submitting pool operator transaction:', e);
      snackbar.setError(getErrorMessage(e, t('errors.unknownError') as string));
    } finally {
      loading.value = false;
    }
  };

  /**
   * Full sign + submit flow. Ledger wallets run the staged orchestration
   * instead (stops at 'readyToSubmit' for an explicit, separate submit).
   */
  const handleSign = async () => {
    if (isLedgerWallet.value) {
      await runLedgerFlow();
      return;
    }
    const signed = await signTx();
    if (signed) {
      await submitTx();
    }
  };

  /**
   * Dialog close/abort. If the hot key was never funded, or a sweep already
   * confirmed, it's safe to drop it immediately. Otherwise real ADA may still
   * be sitting on the hot address: attempt a sweep first and only reset the
   * key if that sweep actually lands. On failure, keep the key live and leave
   * `strandedFunds`/`retrySweep()` in place for the dialog to surface.
   */
  const resetState = async (): Promise<void> => {
    let safeToRetireKey = !funded.value || swept.value;
    if (!safeToRetireKey) {
      safeToRetireKey = await doSweep();
    }
    if (safeToRetireKey) {
      hotFeeKey.reset();
      strandedFunds.value = null;
      funded.value = false;
      swept.value = false;
      fundTxId.value = null;
      hotFundsUtxo = null;
      hotAddressState = null;
      pendingSuccessTxId = null;
    } else {
      markStranded();
    }

    spendingPassword.value = '';
    txCbor.value = '';
    txWitnesses.value = null;
    coldKeyWitness.value = null;
    isSubmit.value = false;
    privateKeyBytes.value = null;
    loading.value = false;
    phase.value = 'idle';
    assembledTx.value = null;
  };

  return {
    loading,
    spendingPassword,
    passwordRules,
    valid,
    isSubmit,
    isPrfWallet,
    isLedgerColdKey,
    isLedgerWallet,
    phase,
    assembledTx,
    privateKeyBytes,
    funded,
    swept,
    strandedFunds,
    signTx,
    submitTx,
    runLedgerFlow,
    submitLedgerTx,
    handleSign,
    resetState,
    retrySweep,
  };
}
