/**
 * DUST sources — cross-wallet cNIGHT → DUST orchestration from the MIDNIGHT wallet.
 *
 * From inside a Midnight wallet, enumerates every Cardano identity the user
 * controls on the anchored Cardano network (Midnight preprod ↔ Cardano preprod
 * etc.), shows each one's NIGHT balance + DUST registration status, and lets
 * the user register/redirect DUST generation to THIS wallet's own DUST address:
 *
 *  - **Same-seed twin**: the Cardano identity derived from the Midnight
 *    wallet's own mnemonic. `MidnightAddresses` persists its base/stake
 *    addresses + payment key hash at derivation time, so it's shown with no
 *    auth gesture. Signing decrypts the logged wallet's mnemonic (one
 *    password/PassKey gesture).
 *  - **Imported Cardano wallets**: other wallet records (`geroStore.wallets`)
 *    on the same Cardano network. Addresses derive from each record's public
 *    xpub (no keys needed to display); signing requires THAT record's
 *    password/PassKey.
 *  - **Watch-only / hardware records**: listed read-only (no local mnemonic).
 *
 * Signing bypasses the logged-wallet SIGN_TX pipeline (which signs with the
 * logged wallet's keys) and instead builds the witness set locally in the
 * options context from the source's mnemonic — exactly the two witnesses the
 * mapping-validator tx requires (payment + stake, both in requiredSigners).
 * The tx id is recomputed from the CBOR before signing (never trust a
 * server-supplied hash); witnesses are merged locally with a body-hash guard
 * and the signed tx is submitted through NEXUS (never Blockfrost/Koios).
 *
 * Balances, statuses, tx-building AND submission all go through Nexus — the
 * wallet never queries or submits to an explorer directly.
 */

import { computed, ref } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, CoinTypes, HARDENED, Wallet, WalletTypePurpose } from '@/models/types';
import {
  DustRegistrationUtxoDto,
  getMidnightApi,
  MidnightDustRegistrationStatusDto,
} from '@/api/midnight-api';
import { CNIGHT_ASSETS, mapDustBuildError } from '@/shared/composables/useCnightDustRegistration';
import { clearDustPending, markDustPending, reconcileDustPending } from '@/shared/composables/useDustPending';
import {
  CardanoStakeIdentity,
  enumerateCardanoStakeIdentities,
} from '@/shared/composables/useCardanoStakeEnumeration';
import { debugLog } from '@/utils/debug';

export interface DustSource extends CardanoStakeIdentity {
  /** Raw cNIGHT base units; null while loading / on query failure. */
  nightBalance: bigint | null;
  status: MidnightDustRegistrationStatusDto | null;
  /** True once `dust/status` has answered for this row. A FAILED batch must
   *  not read as "unregistered" — see `rowState`'s 'unknown' branch. */
  statusLoaded: boolean;
  /** Live registration UTxOs for this stake credential (`dust/registrations`),
   *  the only view of CONFIRMED Cardano state. `dust/status` proxies the
   *  Midnight indexer, which lags the Cardano chain by the ~2.5h relay and
   *  reports `registered:false` for a stake that already carries a live
   *  registration — so this list, not the boolean, is what decides whether a
   *  Register CTA may be offered at all. */
  registrations: DustRegistrationUtxoDto[];
  /** True once `dust/registrations` has answered, so an EMPTY list can be
   *  trusted as "no live registration" rather than "not loaded". */
  registrationsLoaded: boolean;
  /** Wallet-local "submitted, not yet relayed" marker. Nexus's `dust/status`
   *  carries no status-string field (only `registered`), so this row-level
   *  flag — not a field on the DTO — is what the UI renders as "Pending". */
  pendingLocal: boolean;
}

/**
 * What a source row may offer, mirroring `useCnightDustRegistration`'s
 * `registrationStatus` on the Cardano side so the two DUST surfaces agree on
 * the same chain facts:
 *
 *  - `generatingHere`  live-registered to THIS wallet's dust address.
 *  - `duplicated`      >1 live registration UTxO — protocol-invalid, the whole
 *                      set generates nothing until it is back down to one.
 *                      Consolidation lives on the Cardano wallet's own dialog.
 *  - `registeredElsewhere` exactly one live registration, pointed somewhere
 *                      else (or not yet relayed, so the destination is not
 *                      known here). Offer Redirect, never Register.
 *  - `pending`         we submitted a register/redirect from this profile and
 *                      the chain has not caught up yet.
 *  - `readOnly`        no local keys (hardware / watch-only).
 *  - `unknown`         the chain queries did not answer. FAIL CLOSED: no CTA,
 *                      because "unregistered" and "query failed" are the same
 *                      shape on the wire and guessing wrong invites a
 *                      duplicate registration.
 *  - `unregistered`    confirmed clear — the only state that offers Register.
 */
export type DustSourceRowState =
  | 'generatingHere'
  | 'duplicated'
  | 'registeredElsewhere'
  | 'pending'
  | 'readOnly'
  | 'unknown'
  | 'unregistered';

export type DustSourceActionResult =
  | { status: 'submitted'; txHash: string }
  | { status: 'error'; message: string };

interface SourceCredentials {
  password?: string;
  /** Pre-evaluated PRF output for the SOURCE wallet's credential. */
  prfOutput?: ArrayBuffer;
}

const STATUS_BATCH_LIMIT = 50;

/** Conway max tx size. */
const MAX_TX_BYTES = 16384;
/** Register/update unsigned CBOR ceiling — leaves headroom for the 2 vkey witnesses (~204 B). */
const REGISTER_SIZE_THRESHOLD = 16000;
/** Isolation-confirmation poll: rebuild the register tx every 15s, up to ~6 min. */
const ISOLATION_POLL_MS = 15_000;
const ISOLATION_MAX_POLLS = 24;

/**
 * The single decision point for what a source row may do, shared by the dialog
 * template and by `registerSource`'s own pre-flight guard so the button and the
 * action can never disagree.
 *
 * Order matters, and mirrors `useCnightDustRegistration`'s `registrationStatus`:
 * confirmed CARDANO state (`registrations`) outranks the lagging Midnight
 * indexer (`status.registered`), which outranks the local pending marker.
 * Anything we could not read fails CLOSED to 'unknown'.
 */
export function dustSourceRowState(
  source: DustSource,
  ownDustAddress: string,
  /** This wallet's dust address as the raw datum hex `dust/registrations`
   *  reports. Optional: when it hasn't been derived yet the row simply falls
   *  back to the indexer's (lagging) view. */
  ownDustAddressHex = '',
): DustSourceRowState {
  // Duplicated wins over everything: the protocol invalidates the whole set the
  // moment a second live registration UTxO exists, so neither Register nor
  // Redirect is meaningful until it's back down to one.
  if (source.registrations.length > 1) return 'duplicated';

  // Live-registered to THIS wallet — the indexer knows the destination.
  if (source.status?.registered
    && !!source.status.dustAddress
    && !!ownDustAddress
    && source.status.dustAddress.toLowerCase() === ownDustAddress.toLowerCase()) {
    return 'generatingHere';
  }

  // Confirmed on Cardano as pointing HERE, but the indexer hasn't relayed it.
  // Without this the row offered "Redirect here" for a registration that is
  // already ours — a second signature and network fee that changes nothing.
  // Compared as datum hex because that's what `dust/registrations` reports.
  if (source.registrations.length === 1
    && !!ownDustAddressHex
    && source.registrations[0].dustAddressHex.toLowerCase() === ownDustAddressHex.toLowerCase()) {
    return 'pending';
  }

  // We submitted a register/redirect from this profile that the chain hasn't
  // caught up with yet. Ranked above `registeredElsewhere` (as the template
  // always has) so an in-flight redirect reads as pending rather than
  // re-offering the button that started it — safe either way, since 'pending'
  // offers no Register CTA.
  if (source.pendingLocal) return 'pending';

  // Exactly one live registration UTxO on Cardano. Valid regardless of whether
  // the indexer has relayed it yet, and regardless of where it points — either
  // way the answer is Redirect, never Register. This is the case that used to
  // fall through to a Register CTA and create a duplicate.
  if (source.registrations.length === 1 || source.status?.registered) {
    return source.canSign ? 'registeredElsewhere' : 'readOnly';
  }

  // Both chain reads must have actually answered before a row may claim to be
  // clear. "Unregistered" and "the query failed" look identical on the wire.
  //
  // Ranked ABOVE the read-only fallback: a watch-only row whose lookup failed
  // is still a failed lookup, and labelling it "read only" states we know its
  // registration when we do not. Neither label offers a CTA, so this only
  // changes what the row claims — which is the point.
  if (!source.registrationsLoaded || !source.statusLoaded) return 'unknown';

  if (!source.canSign) return 'readOnly';

  return 'unregistered';
}

/** Progress stage for the two-step (isolate → wait → register) flow. */
export type DustSourceStage = 'registering' | 'isolating' | 'waitingIsolation';

export function useDustSources() {
  const sources = ref<DustSource[]>([]);
  const loading = ref(false);
  const working = ref(false);

  const network = computed<string>(() => walletStore.loggedWallet?.network ?? '');
  const ownDustAddress = computed<string>(() => midnightStore.addresses?.dust ?? '');
  /** `ownDustAddress` as the raw datum hex, so rows can be matched against
   *  `dust/registrations`. Derived once per refresh (pure decode, no keys). */
  const ownDustAddressHex = ref('');
  const isSupported = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT && !!CNIGHT_ASSETS[network.value]);

  /**
   * Enumerate every Cardano identity the wallet controls and layer on the
   * per-row loading state this dialog needs (balance/status/pendingLocal).
   * The identity derivation itself (same-seed twin + imported records) is
   * shared with `useDustPathB` via `useCardanoStakeEnumeration` — see that
   * module's header comment for why the two surfaces must agree.
   */
  async function enumerate(): Promise<DustSource[]> {
    const identities = await enumerateCardanoStakeIdentities(network.value);
    return identities.map((identity) => ({
      ...identity,
      nightBalance: null,
      status: null,
      statusLoaded: false,
      registrations: [],
      registrationsLoaded: false,
      pendingLocal: false,
    }));
  }

  /** Sum each source's cNIGHT via Nexus's asset-filtered address-UTxO endpoint. */
  async function loadBalances(list: DustSource[]): Promise<void> {
    const asset = CNIGHT_ASSETS[network.value];
    if (!asset || list.length === 0) return;
    const unit = asset.policyId + asset.assetNameHex;
    const api = getMidnightApi(network.value);
    await Promise.all(list.map(async (source) => {
      try {
        const utxos = await api.getCardanoAssetUtxos(source.baseAddress, unit);
        let total = 0n;
        for (const u of utxos) {
          for (const a of u.assets ?? []) {
            const matches = a.unit === unit
              || (a.policyId === asset.policyId && (a.assetName ?? '') === asset.assetNameHex);
            if (matches && a.quantity) total += BigInt(a.quantity);
          }
        }
        source.nightBalance = total;
      } catch (e) {
        // Leave the balance null — the row renders as unknown rather than zero.
        debugLog('[DustSources] balance query failed for', source.baseAddress, e);
      }
    }));
  }

  async function loadStatuses(list: DustSource[]): Promise<void> {
    if (list.length === 0) return;
    const api = getMidnightApi(network.value);
    for (let i = 0; i < list.length; i += STATUS_BATCH_LIMIT) {
      const chunk = list.slice(i, i + STATUS_BATCH_LIMIT);
      try {
        const statuses = await api.getDustStatusBatch(chunk.map(s => s.stakeAddress));
        for (const st of statuses) {
          const source = chunk.find(s => s.stakeAddress === st.cardanoRewardAddress);
          if (!source) continue;
          source.status = st;
          // Only a row Nexus actually answered for is "loaded". A row missing
          // from the response is as unknown as a thrown batch — never a clear.
          source.statusLoaded = true;
        }
      } catch (e) {
        // Leave `statusLoaded` false on every row in this chunk: the dialog
        // renders them as 'unknown' (no CTA) rather than inviting a duplicate
        // registration on top of a live one it simply could not see.
        debugLog('[DustSources] status batch failed:', e);
      }
    }
    // Overlay the local pending guard: a source we just registered (but the
    // indexer hasn't relayed yet) shows Pending so its row can't re-register.
    for (const source of list) {
      if (source.status?.registered) {
        clearDustPending(source.stakeAddress);
        source.pendingLocal = false;
        continue;
      }
      // Reconcile first: a submission that never landed on-chain must not keep
      // the row stuck on "Registration pending" (blocking a real retry).
      const pending = await reconcileDustPending(
        source.stakeAddress,
        (txHash) => api.cardanoTxExists(txHash),
      );
      if (pending && !source.pendingLocal) {
        source.status = {
          cardanoRewardAddress: source.stakeAddress,
          dustAddress: pending.dustAddress,
          registered: false,
          registrationUtxoTxHash: pending.txHash,
        };
      }
      source.pendingLocal = !!pending;
    }
  }

  /**
   * Live registration UTxOs per source (`dust/registrations`) — CONFIRMED
   * Cardano state, the counterpart to `dust/status`'s indexer view.
   *
   * This is the guard the Midnight side was missing. `dust/status` proxies the
   * Midnight indexer, which lags the Cardano chain by the ~2.5h relay, so a
   * stake that already carries a live registration — made from the Cardano
   * wallet's own dialog, the official portal, another browser profile, or for
   * a DIFFERENT Midnight wallet — reads `registered:false` here. The local
   * `gero.dustPending` marker only covers submissions from this profile, so
   * without this call the row rendered a Register CTA and a second live
   * registration UTxO could be created, which invalidates the whole set
   * (exactly one live registration per stake credential is valid).
   *
   * Per-address GET, run in parallel like `loadBalances`. A failure leaves
   * `registrationsLoaded` false so the row falls to 'unknown' (no CTA) rather
   * than to 'unregistered'.
   */
  async function loadRegistrations(list: DustSource[]): Promise<void> {
    if (list.length === 0) return;
    const api = getMidnightApi(network.value);
    await Promise.all(list.map(async (source) => {
      try {
        source.registrations = await api.getDustRegistrations(source.stakeAddress);
        source.registrationsLoaded = true;
      } catch (e) {
        debugLog('[DustSources] registrations query failed for', source.stakeAddress, e);
      }
    }));
  }

  async function deriveOwnDustAddressHex(): Promise<void> {
    const address = ownDustAddress.value;
    if (!address) { ownDustAddressHex.value = ''; return; }
    try {
      const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      ownDustAddressHex.value = dustAddressToHex(address);
    } catch (e) {
      // Non-fatal: rows fall back to the indexer's view of the destination.
      debugLog('[DustSources] could not derive own dust address hex', e);
      ownDustAddressHex.value = '';
    }
  }

  async function refresh(): Promise<void> {
    if (!isSupported.value) {
      sources.value = [];
      return;
    }
    loading.value = true;
    try {
      await deriveOwnDustAddressHex();
      const list = await enumerate();
      sources.value = list;
      await Promise.all([loadBalances(list), loadStatuses(list), loadRegistrations(list)]);
      // Reassign to poke reactivity after in-place mutation of row fields.
      sources.value = [...list];
    } finally {
      loading.value = false;
    }
  }

  /** Decrypt the SOURCE wallet's mnemonic (the logged wallet's for the twin). */
  async function decryptSourceMnemonic(
    source: DustSource, credentials: SourceCredentials,
  ): Promise<string> {
    const record: (Wallet & { id: number }) | undefined = source.sameSeed
      ? walletStore.loggedWallet
      : (geroStore.wallets ?? {})[source.walletId as number] as Wallet;
    if (!record) throw new Error('Source wallet record not found');

    if (credentials.prfOutput) {
      if (!record.prfEncryptedMnemonic || !record.webAuthnCredentialId) {
        throw new Error('PassKey wallet is missing its encrypted mnemonic');
      }
      const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
      return decryptMnemonicWithPrfOutput(
        record.prfEncryptedMnemonic,
        credentials.prfOutput,
        record.webAuthnCredentialId,
        record.id.toString(),
      );
    }
    if (!record.encryptedMnemonic) {
      throw new Error('Wallet has no local mnemonic (hardware or watch-only)');
    }
    const { decrypt } = await import('@/shared/utils/crypto');
    try {
      return decrypt(record.encryptedMnemonic, credentials.password ?? '');
    } catch {
      throw new Error('WRONG_PASSWORD');
    }
  }

  /**
   * Sign a tx locally with the source's keys at the given CIP-1852 paths.
   * The tx id is recomputed from the CBOR (deserialize) — the witness signs
   * what will actually be submitted, not a server-claimed hash.
   *
   * Paths: the mapping tx needs payment [0,0] (inputs) + stake [2,0] (the
   * validator's extra_signatories check on the datum's c_wallet); a plain
   * self-send needs only payment [0,0] (an extra witness would inflate the
   * tx past the fee Nexus estimated for it).
   */
  async function signWithMnemonic(
    txCbor: string, mnemonic: string, paths: number[][] = [[0, 0], [2, 0]],
  ): Promise<string> {
    const [{ deserializeCardanoJsSdkTx }, { Serialization }, { HexBlob }, { resolvePrivateKey }] =
      await Promise.all([
        import('@/chrome/cardanoJsSdkCbor'),
        import('@cardano-sdk/core'),
        import('@cardano-sdk/util'),
        import('@/shared/utils/resolver'),
      ]);
    const transaction = deserializeCardanoJsSdkTx(txCbor);
    const rootKey = resolvePrivateKey(mnemonic);
    const accountKey = rootKey.derive([
      WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED,
    ]);

    const signatures = new Map<string, string>();
    for (const path of paths) {
      const key = accountKey.derive(path);
      const raw = key.toRawKey();
      signatures.set(raw.toPublic().hex(), raw.sign(HexBlob(transaction.id)).hex());
    }
    const witness = { signatures } as Parameters<typeof Serialization.TransactionWitnessSet.fromCore>[0];
    return Serialization.TransactionWitnessSet.fromCore(witness).toCbor();
  }

  /** Guard: the decrypted seed must actually derive this source's address. */
  async function assertSeedMatchesSource(mnemonic: string, source: DustSource): Promise<void> {
    const { getAddress } = await import('@/chrome/serialization');
    const { resolvePrivateKey } = await import('@/shared/utils/resolver');
    const { SodiumBip32Ed25519 } = await import('@cardano-sdk/crypto');
    const { bech32 } = await import('bech32');
    const rootKey = resolvePrivateKey(mnemonic);
    const bip32Ed25519 = await SodiumBip32Ed25519.create();
    const xpubHex = bip32Ed25519.getBip32PublicKey(
      rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).hex(),
    );
    const xpub = bech32.encode('xpub', bech32.toWords(Buffer.from(xpubHex, 'hex')), 120);
    const derivedBase = getAddress(xpub, Blockchain.CARDANO, network.value, 0).toBech32();
    if (derivedBase !== source.baseAddress) {
      throw new Error('Decrypted seed does not derive this Cardano address');
    }
  }

  /**
   * Merge the locally-produced vkey witnesses into the tx and submit through
   * NEXUS (never Blockfrost/Koios). The witness merge must not alter the body
   * bytes — same integrity guard the background SUBMIT_TX path applies — so a
   * swapped body can't slip in with the witnesses. Nexus returns the node's
   * real ledger error on rejection.
   */
  async function mergeAndSubmit(txCbor: string, witnessHex: string): Promise<string> {
    const [{ Serialization }, { HexBlob }] = await Promise.all([
      import('@cardano-sdk/core'),
      import('@cardano-sdk/util'),
    ]);
    const tx = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    const bodyHashBefore = tx.body().hash();
    const witnessSet = tx.witnessSet();
    const incoming = Serialization.TransactionWitnessSet.fromCbor(HexBlob(witnessHex)).toCore();
    const merged = new Map([
      ...(witnessSet.toCore().signatures?.entries() ?? []),
      ...incoming.signatures.entries(),
    ]);
    witnessSet.setVkeys(Serialization.CborSet.fromCore([...merged.entries()], Serialization.VkeyWitness.fromCore));
    tx.setWitnessSet(witnessSet);
    if (tx.body().hash() !== bodyHashBefore) {
      throw new Error('Transaction body changed while applying witnesses; refusing to submit');
    }
    return getMidnightApi(network.value).submitCardanoTx(tx.toCbor());
  }

  const cborBytes = (hex: string) => Math.ceil(hex.length / 2);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * Build a cNIGHT self-send that isolates all of `source`'s cNIGHT into a
   * clean single-asset UTxO (Option C). This is a plain multi-asset transfer
   * (no script), so its change output re-lists the wallet's token bag but the
   * tx stays well under the 16 KB limit — where the combined register+rotation
   * tx would not. Reuses Nexus `/api/tx/build`.
   */
  async function buildIsolationTx(source: DustSource): Promise<string> {
    const asset = CNIGHT_ASSETS[network.value];
    if (!asset) throw new Error('cNIGHT not configured for this network');
    if (source.nightBalance === null || source.nightBalance <= 0n) {
      throw new Error('No NIGHT balance to isolate');
    }
    const { nexusTxApi } = await import('@/api/nexus-tx-api');
    // 2 ADA covers min-UTxO for a single-asset output with headroom; it stays
    // in the source wallet (recovered as change when the register tx rotates
    // this UTxO). senderAddress = changeAddress = the source's own address.
    const resp = await nexusTxApi.buildTransferTx({
      outputs: [{
        address: source.baseAddress,
        lovelace: '2000000',
        assets: [{
          policyId: asset.policyId,
          assetName: asset.assetNameHex,
          quantity: source.nightBalance.toString(),
        }],
      }],
      changeAddress: source.baseAddress,
      senderAddress: source.baseAddress,
    }, network.value);
    if (!resp?.tx_cbor) throw new Error('Nexus did not return an isolation transaction');
    if (cborBytes(resp.tx_cbor) > MAX_TX_BYTES) {
      throw new Error('TOKEN_BAG_TOO_LARGE');
    }
    return resp.tx_cbor;
  }

  /**
   * True once the source holds a cNIGHT UTxO carrying ONLY cNIGHT (no token
   * bag) — i.e. the isolation tx has confirmed. Waiting on this rather than
   * "the register tx now fits" avoids a race: right after the heavy UTxO is
   * spent but before the clean one is indexed, Nexus would build a small
   * register tx that rotates NOTHING, registering the mapping without
   * activating the existing NIGHT.
   */
  async function cnightIsIsolated(source: DustSource): Promise<boolean> {
    const asset = CNIGHT_ASSETS[network.value];
    if (!asset) return false;
    const unit = asset.policyId + asset.assetNameHex;
    const isCnight = (a: { unit?: string; policyId?: string; assetName?: string }) =>
      a.unit === unit || (a.policyId === asset.policyId && (a.assetName ?? '') === asset.assetNameHex);
    try {
      const utxos = await getMidnightApi(network.value).getCardanoAssetUtxos(source.baseAddress, unit);
      return utxos.some((u) => {
        const assets = u.assets ?? [];
        const hasNight = assets.some(isCnight);
        const others = assets.filter((a) => !isCnight(a) && a.unit !== 'lovelace');
        return hasNight && others.length === 0;
      });
    } catch {
      return false;
    }
  }

  /**
   * Build the register/update tx; if it exceeds the size limit (the source's
   * cNIGHT sits in a heavy multi-asset UTxO), isolate the cNIGHT first
   * (Option C), wait for that to confirm, then rebuild — at which point Nexus
   * rotates only the clean cNIGHT UTxO and the tx fits. Returns the final CBOR.
   */
  async function buildFittingTx(
    source: DustSource, mnemonic: string,
    buildFn: () => Promise<string>,
    onStage?: (stage: DustSourceStage) => void,
  ): Promise<string> {
    const cbor = await buildFn();
    if (cborBytes(cbor) <= REGISTER_SIZE_THRESHOLD) return cbor;

    // Too big → isolate the cNIGHT (plain self-send, payment-only witness).
    onStage?.('isolating');
    const isoCbor = await buildIsolationTx(source);
    const isoWit = await signWithMnemonic(isoCbor, mnemonic, [[0, 0]]);
    await mergeAndSubmit(isoCbor, isoWit);

    // Wait for the isolation to confirm (clean cNIGHT UTxO present), then
    // rebuild — now Nexus rotates only that clean UTxO and the tx fits.
    onStage?.('waitingIsolation');
    for (let i = 0; i < ISOLATION_MAX_POLLS; i++) {
      await sleep(ISOLATION_POLL_MS);
      if (!(await cnightIsIsolated(source))) continue;
      const rebuilt = await buildFn();
      if (cborBytes(rebuilt) <= REGISTER_SIZE_THRESHOLD) return rebuilt;
    }
    throw new Error('ISOLATION_TIMEOUT');
  }

  /** Register `source`'s NIGHT to generate DUST at THIS Midnight wallet's address. */
  async function registerSource(
    source: DustSource, credentials: SourceCredentials,
    onStage?: (stage: DustSourceStage) => void,
  ): Promise<DustSourceActionResult> {
    if (!ownDustAddress.value) {
      return { status: 'error', message: 'This wallet has no DUST address yet' };
    }
    // Re-check against the same derivation the button rendered from, so a
    // status that landed between render and click (or a row the template
    // enabled by mistake) can never build a SECOND registration on a stake
    // that already has one — which would invalidate the whole set.
    const state = dustSourceRowState(source, ownDustAddress.value, ownDustAddressHex.value);
    if (state !== 'unregistered') {
      return { status: 'error', message: 'ALREADY_REGISTERED' };
    }
    working.value = true;
    try {
      const mnemonic = await decryptSourceMnemonic(source, credentials);
      await assertSeedMatchesSource(mnemonic, source);

      const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      const dustAddressHex = dustAddressToHex(ownDustAddress.value);
      const api = getMidnightApi(network.value);
      const buildRegister = async () => {
        const build = await api.buildDustRegistrationTx({
          cardanoAddress: source.baseAddress,
          paymentKeyHashHex: source.paymentKeyHashHex,
          dustAddressHex,
        });
        if (build.status !== 'complete' || !build.txCbor) {
          throw new Error(build.note || 'Nexus did not return a complete registration transaction');
        }
        return build.txCbor;
      };

      onStage?.('registering');
      const txCbor = await buildFittingTx(source, mnemonic, buildRegister, onStage);
      const witnessHex = await signWithMnemonic(txCbor, mnemonic);
      const txId = await mergeAndSubmit(txCbor, witnessHex);

      markDustPending(source.stakeAddress, ownDustAddress.value, txId);
      source.status = {
        cardanoRewardAddress: source.stakeAddress,
        dustAddress: ownDustAddress.value,
        registered: false,
        registrationUtxoTxHash: txId,
      };
      source.pendingLocal = true;
      sources.value = [...sources.value];
      return { status: 'submitted', txHash: txId };
    } catch (e) {
      return { status: 'error', message: mapDustBuildError(e instanceof Error ? e.message : String(e)) };
    } finally {
      working.value = false;
    }
  }

  /** Re-point `source`'s existing registration at THIS wallet's DUST address. */
  async function redirectSource(
    source: DustSource, credentials: SourceCredentials,
    onStage?: (stage: DustSourceStage) => void,
  ): Promise<DustSourceActionResult> {
    // Prefer the CONFIRMED Cardano registration UTxO over the indexer's copy:
    // during the ~2.5h relay `dust/status` carries no outpoint at all, and
    // that's exactly when a user wants to re-point a registration they can
    // already see on Cardano. Falling back to `status` keeps registrations
    // made before `dust/registrations` existed working.
    const live = source.registrations.length === 1 ? source.registrations[0] : null;
    const txHash = live?.txHash ?? source.status?.registrationUtxoTxHash;
    const outputIndex = live ? live.outputIndex : source.status?.registrationUtxoOutputIndex;
    if (!ownDustAddress.value) {
      return { status: 'error', message: 'This wallet has no DUST address yet' };
    }
    if (source.registrations.length > 1) {
      return { status: 'error', message: 'DUPLICATE_REGISTRATIONS' };
    }
    if (!txHash || outputIndex === null || outputIndex === undefined) {
      return { status: 'error', message: 'Registration UTxO not known yet. Refresh and try again.' };
    }
    working.value = true;
    try {
      const mnemonic = await decryptSourceMnemonic(source, credentials);
      await assertSeedMatchesSource(mnemonic, source);

      const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      const dustAddressHex = dustAddressToHex(ownDustAddress.value);
      const api = getMidnightApi(network.value);
      const buildUpdate = async () => {
        const build = await api.buildDustUpdateTx({
          cardanoAddress: source.baseAddress,
          paymentKeyHashHex: source.paymentKeyHashHex,
          registrationUtxoTxHash: txHash,
          registrationUtxoOutputIndex: outputIndex,
          dustAddressHex,
        });
        if (build.status !== 'complete' || !build.txCbor) {
          throw new Error(build.note || 'Nexus did not return a complete update transaction');
        }
        return build.txCbor;
      };

      onStage?.('registering');
      const finalCbor = await buildFittingTx(source, mnemonic, buildUpdate, onStage);
      const witnessHex = await signWithMnemonic(finalCbor, mnemonic);
      const txId = await mergeAndSubmit(finalCbor, witnessHex);

      markDustPending(source.stakeAddress, ownDustAddress.value, txId);
      source.status = {
        cardanoRewardAddress: source.stakeAddress,
        dustAddress: ownDustAddress.value,
        registered: false,
        registrationUtxoTxHash: txId,
      };
      source.pendingLocal = true;
      sources.value = [...sources.value];
      return { status: 'submitted', txHash: txId };
    } catch (e) {
      return { status: 'error', message: mapDustBuildError(e instanceof Error ? e.message : String(e)) };
    } finally {
      working.value = false;
    }
  }

  return {
    sources,
    loading,
    working,
    isSupported,
    ownDustAddress,
    ownDustAddressHex,
    refresh,
    registerSource,
    redirectSource,
  };
}
