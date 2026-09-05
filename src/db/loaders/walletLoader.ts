import Dexie from 'dexie';
import { BaseLoader } from './base';
import WalletStore from '@/stores/walletStore';
import { toStakeAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import Loading from '@/stores/loading';
import { StoredTransaction, TxAsset } from '@/models/transaction.types';

/** Loose UTxO shape used for input token-amount resolution (see resolveInputAmounts). */
type ResolvableUtxo = { tx_hash?: string; output_index?: number; address?: string; amount?: unknown[] };

/** One entry of a UTxO's `amount` array — lovelace, or a native asset. */
interface UtxoAmount {
  unit: string;
  quantity: string | number;
}

/**
 * The UTxO fields the sent/received accounting reads. Structurally satisfied by
 * both `UtxoInput` and `UtxoOutput`, which is why it is spelled out here rather
 * than imported: the accounting treats the two identically.
 *
 * `datum_hash` is optional because the received-side guard reads it — but note
 * that neither stored shape carries that key; both spell it `data_hash`. The
 * guard has therefore never fired. Typed as optional to keep the behaviour
 * exactly as it is rather than silently change transaction accounting.
 */
interface AccountedUtxo {
  address?: string;
  amount?: UtxoAmount[];
  data_hash?: string | null;
  datum_hash?: string | null;
}

/**
 * One asset accumulated across a transaction's UTxOs, its quantity summed.
 *
 * This is the model's own `TxAsset`. The single assertion needed to produce one
 * lives in `updateAssetMap`, and is explained there.
 */
type AccountedAsset = TxAsset;

/**
 * Loader for wallet account information
 */
export class AccountLoader extends BaseLoader {
  constructor(
    private getDb: () => Promise<Dexie>,
    private walletId: number
  ) {
    super('account');
  }

  async load(): Promise<unknown> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('account').where({ walletId: this.walletId }).first(),
      (account) => {
        // Every emission is passed through, including an empty one.
        //
        // A `if (!account) return` guard lived here briefly. It was added on a
        // hunch while chasing an unrelated flicker, did not fix that flicker,
        // and changed what a wallet SWITCH looks like: the new wallet's loader
        // subscribes with no row of its own yet, and swallowing that emission
        // leaves the store holding whatever the last write left behind until
        // something writes the account table again — which, on a wallet already
        // at the tip, is not until the next SYNC_CHECK_OK carries an account.
        // An empty answer about the current wallet is information; withholding
        // it only makes the gap silent.
        WalletStore.setAccount(account);
      },
      (error) => {
        console.error('Failed to Fetch AccountInfo:', error);
      }
    );
  }
}

/**
 * Loader for wallet contacts
 */
export class ContactsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('contacts');
  }

  async load(): Promise<unknown> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('contacts').toArray(),
      (newContacts) => {
        const contacts = newContacts.reduce(function(map, contact) {
          map[contact.address] = contact;
          return map;
        }, {});
        WalletStore.setContacts(contacts);
      },
      (error) => {
        console.error('Failed to Fetch Contacts:', error);
      }
    );
  }
}

/**
 * Loader for wallet configuration
 */
export class ConfigLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('config');
  }

  async load(): Promise<unknown> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('config').toArray(),
      (config) => {
        WalletStore.setConfig(config.reduce(function(map, val) {
          map[val.key] = val.value;
          return map;
        }, {}));
      }
    );
  }
}

/**
 * Loader for rewards data
 */
export class RewardsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('rewards');
  }

  async load(): Promise<unknown> {
    const db = await this.getDb();

    return this.createSubscription(
      () => db.table('rewards').orderBy("epoch").toArray(),
      (newRewards) => {
        WalletStore.setRewards(newRewards);
      }
    );
  }
}

/**
 * Loader for connected DApps
 */
export class ConnectedDappsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('dapps');
  }

  async load(): Promise<unknown> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('connected_dapps').toArray(),
      (newConnectedDapps) => {
        WalletStore.setConnectedDapps(newConnectedDapps);
      },
      (error) => {
        console.error('Failed to Fetch Connected Dapps:', error);
      }
    );
  }
}

/**
 * Loader for wallet transactions with complex processing
 */
export class TransactionsLoader extends BaseLoader {
  constructor(
    private getDb: () => Promise<Dexie>,
    private walletContext: {
      baseAddress: string;
      stakeAddress: string;
      chain: string;
      network: string;
      isEnterpriseAddress: () => boolean;
      networkId: () => number;
      setUtxosAndAddresses: (transactions: StoredTransaction[]) => Promise<void>;
      triggerResync?: () => Promise<void>;
    }
  ) {
    super('transactions');
  }

  async load(): Promise<unknown> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('transactions').toArray(),
      async (newTransactions: StoredTransaction[]) => {
        Loading.setLoadingTxs(true);
        console.log('new TXs', newTransactions)
        try {
          // Check for the old transaction format and trigger migration if needed
          if (await this.detectAndHandleOldTransactionFormat(newTransactions)) {
            return; // Exit early as a resync is in progress
          }

          let transactions: StoredTransaction[] = [];
          if (newTransactions?.length) {
            const isEnterpriseAddress = this.walletContext.isEnterpriseAddress();
            const currentAddress = isEnterpriseAddress ? this.walletContext.baseAddress : '';
            const currentStake = !isEnterpriseAddress ? this.walletContext.stakeAddress : '';
            const networkId = this.walletContext.networkId();
            const network = networks.resolveNetwork(this.walletContext.chain, this.walletContext.network);

            const nativeAssetMetadata = {
              decimals: 6,
              description: network?.currencyDescription,
              logo: network?.currencyImage,
              name: network?.currencyName,
              ticker: network?.currencyTicker,
            };

            newTransactions.sort((a, b) => a.tx_timestamp - b.tx_timestamp);

            // gero-sync's live-block path can't resolve consumed inputs (Yaci block
            // events ship only the input ref). Build an index of every produced output
            // we have synced, then backfill missing input.address/amount before sentAmount
            // accounting. Without this, sends look like "received" because sentAmount=0.
            const outputIndex = new Map<string, { address?: string; amount?: unknown[] }>();
            for (const tx of newTransactions) {
              const outs = tx.utxo?.outputs;
              if (!outs?.length) continue;
              for (const out of outs) {
                if (out.address && out.output_index != null) {
                  outputIndex.set(`${tx.tx_hash}#${out.output_index}`, {
                    address: out.address,
                    amount: out.amount,
                  });
                }
              }
            }

            transactions = newTransactions.map((tx) => {
              let sentAmount = 0;
              let receivedAmount = 0;
              const sentAssets = new Map<string, AccountedAsset>();
              const receivedAssets = new Map<string, AccountedAsset>();

              // Resolve each input's amount from its producing output so sentAsset
              // accounting sees the input's FULL value, incl. native tokens (see
              // resolveInputAmounts). Returns a NEW array — the Dexie-sourced record
              // is not mutated; the resolved inputs are carried on the returned utxo.
              const resolvedInputs = this.resolveInputAmounts(tx.utxo?.inputs, outputIndex);

              // gero-sync's live-block path doesn't emit tx_size — derive it from
              // the cbor byte count (hex string length / 2). humanFileSize handles 0.
              if ((!tx.tx_size || tx.tx_size <= 0) && typeof tx.cbor === 'string' && tx.cbor.length > 0) {
                tx.tx_size = Math.floor(tx.cbor.length / 2);
              }

              this.processUtxos(resolvedInputs, currentAddress, currentStake, networkId, true, sentAssets, (amount) => {
                sentAmount += amount;
              });

              this.processUtxos(tx.utxo?.outputs, currentAddress, currentStake, networkId, false, receivedAssets, (amount) => {
                receivedAmount += amount;
              });

              const totalAmount = receivedAmount - sentAmount;

              const finalAssets = this.calculateFinalAssets(sentAssets, receivedAssets);

              const nativeAsset = {
                unit: "lovelace",
                policy_id: "",
                asset_name: "lovelace",
                quantity: totalAmount,
                metadata: nativeAssetMetadata
              };

              // Carry the resolved inputs on a fresh utxo object so the detail view
              // renders input tokens too, without mutating the source record.
              const utxo = tx.utxo ? { ...tx.utxo, inputs: resolvedInputs ?? tx.utxo.inputs } : tx.utxo;

              return {
                ...tx,
                utxo,
                sentAmount,
                receivedAmount,
                sentAssets: Array.from(sentAssets.values()),
                receivedAssets: Array.from(receivedAssets.values()),
                ada: totalAmount,
                assets: [nativeAsset, ...finalAssets]
              };
            });
          }
          WalletStore.setTransactions(transactions);

          try {
            await this.walletContext.setUtxosAndAddresses(transactions);
          } catch (error) {
            console.error('setUtxosAndAddresses failed:', error);
          }
        } catch (e) {
          console.error(e);
          // Return an empty array on error instead of failing completely
          WalletStore.setTransactions([]);
        } finally {
          Loading.setLoadingTxs(false);
        }
      },
      (error: unknown) => {
        console.error('Failed to fetch transactions:', error);
      }
    );
  }

  /**
   * Resolve each input's amount from its producing output (outputIndex) so sent-asset
   * accounting sees the input's FULL value, including native tokens. Returns a NEW
   * array (the Dexie-sourced record is never mutated).
   *
   * gero-sync/nexus history stores spent inputs lovelace-only. The old guard
   * `inp.address && inp.amount?.length` treated a lovelace-only input as
   * already-resolved and kept it token-less, so a spent multi-asset UTxO's tokens
   * never offset the change output's tokens and a small send rendered as many tokens
   * moved. The producing output IS the input's real value, so prefer its richer amount
   * whenever available; fall back to the input unchanged when the producer isn't
   * locally synced.
   */
  private resolveInputAmounts<T extends ResolvableUtxo>(
    inputs: T[] | undefined,
    outputIndex: Map<string, { address?: string; amount?: unknown[] }>
  ): T[] | undefined {
    if (!inputs?.length) return inputs;
    return inputs.map((inp) => {
      const hit = outputIndex.get(`${inp.tx_hash}#${inp.output_index}`);
      if (!hit) return inp;
      const amount = (hit.amount?.length ?? 0) > (inp.amount?.length ?? 0) ? hit.amount : inp.amount;
      return { ...inp, address: inp.address || hit.address, amount } as T;
    });
  }

  private processUtxos(
    utxos: AccountedUtxo[] | undefined,
    currentAddress: string,
    currentStake: string,
    networkId: number,
    isSent: boolean,
    assetsMap: Map<string, AccountedAsset>,
    addLovelace: (amount: number) => void
  ): void {
    if (!utxos?.length) return;

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const isOwnAddress = utxo.address === currentAddress ||
        toStakeAddress(utxo.address, networkId) === currentStake;

      if (!isOwnAddress || (isSent && utxo.data_hash) || (!isSent && utxo.datum_hash)) {
        continue;
      }

      const amounts = utxo.amount;
      if (!amounts?.length) continue;

      for (let j = 0; j < amounts.length; j++) {
        const amount = amounts[j];
        if (amount.unit === 'lovelace') {
          addLovelace(Number(amount.quantity));
        } else {
          this.updateAssetMap(assetsMap, amount);
        }
      }
    }
  }

  private updateAssetMap(assetsMap: Map<string, AccountedAsset>, asset: UtxoAmount): void {
    const existing = assetsMap.get(asset.unit);
    if (existing) {
      existing.quantity += Number(asset.quantity);
    } else {
      // Asserted, not inferred. `TxAsset` declares policy_id, asset_name and
      // metadata, while the `TxAmount` entries this is summed from declare only
      // unit and quantity. The stored rows DO carry the richer fields —
      // blockchain-api enriches them on the way in — so the spread produces a
      // whole TxAsset at runtime; the two declarations simply disagree, and an
      // `any` here used to hide that. Narrowing `TxAmount` is the real fix, and
      // it is a change to the transaction model rather than to this loader.
      assetsMap.set(asset.unit, {
        ...asset,
        quantity: Number(asset.quantity)
      } as AccountedAsset);
    }
  }

  private calculateFinalAssets(
    sentAssets: Map<string, AccountedAsset>,
    receivedAssets: Map<string, AccountedAsset>
  ): AccountedAsset[] {
    const finalAssets: AccountedAsset[] = [];
    const processedUnits = new Set<string>();

    sentAssets.forEach((sentAsset, unit) => {
      const receivedAsset = receivedAssets.get(unit);
      const quantity = receivedAsset
        ? Number(receivedAsset.quantity) - Number(sentAsset.quantity)
        : -Number(sentAsset.quantity);

      if (quantity !== 0) {
        finalAssets.push({
          ...sentAsset,
          quantity
        });
      }
      processedUnits.add(unit);
    });

    receivedAssets.forEach((receivedAsset, unit) => {
      if (!processedUnits.has(unit)) {
        finalAssets.push(receivedAsset);
      }
    });

    return finalAssets;
  }

  /**
   * Detects old transaction format and triggers migration if needed
   * @param transactions - Array of transaction objects to check
   * @returns Promise<boolean> - true if migration was triggered, false otherwise
   */
  private async detectAndHandleOldTransactionFormat(transactions: object[]): Promise<boolean> {
    if (!transactions?.length) {
      return false;
    }

    // Check if any transaction has the old 'transaction' field
    const hasOldFormat = transactions.some(tx =>
      tx.hasOwnProperty('transaction') ||
      // Check for missing new fields that should exist in the new format
      !tx.hasOwnProperty('utxo')
    );

    if (hasOldFormat) {
      console.log('🔄 Detected old transaction format, triggering resync...');

      try {
        // Clear old transaction data to prepare for fresh sync
        const walletDB = await this.getDb();
        await walletDB.table('transactions').clear();
        console.log('✅ Cleared old transaction data');

        // Trigger resync if the method is available
        if (this.walletContext.triggerResync) {
          await this.walletContext.triggerResync();
          console.log('✅ Resync triggered successfully');
          return true;
        } else {
          console.warn('⚠️ triggerResync method not available in wallet context');
        }
      } catch (error) {
        console.error('❌ Failed to trigger migration resync:', error);
        // Don't block the wallet loading process even if migration fails
      }
    }

    return false;
  }
}
