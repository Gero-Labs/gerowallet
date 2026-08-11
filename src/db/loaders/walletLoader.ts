import Dexie from 'dexie';
import { BaseLoader } from './base';
import WalletStore from '@/stores/walletStore';
import { toStakeAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import Loading from '@/stores/loading';
import { StoredTransaction } from '@/models/transaction.types';

/** Loose UTxO shape used for input token-amount resolution (see resolveInputAmounts). */
type ResolvableUtxo = { tx_hash?: string; output_index?: number; address?: string; amount?: unknown[] };

/** A native-token amount as carried on a stored tx input/output. */
type LoaderAmount = { unit: string; quantity: number | string; policy_id?: string; asset_name?: string };
/** Derived per-asset entry accumulated during sent/received accounting. */
type LoaderAsset = LoaderAmount & { quantity: number; [key: string]: unknown };
/** Loose input/output shape carrying an address and native-token amounts. */
type LoaderUtxo = { address?: string; amount?: LoaderAmount[] };

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

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('account').where({ walletId: this.walletId }).first(),
      (account) => {
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

  async load(): Promise<any> {
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

  async load(): Promise<any> {
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

  async load(): Promise<any> {
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

  async load(): Promise<any> {
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

  async load(): Promise<any> {
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
            const outputIndex = new Map<string, { address?: string; amount?: any[] }>();
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
              const sentAssets = new Map<string, any>();
              const receivedAssets = new Map<string, any>();

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

              // Tokens routed to foreign (non-own) outputs — the assets that actually
              // left the wallet. Always trustworthy, since it reads this tx's own
              // outputs (no dependency on producer resolution).
              const foreignSentAssets = this.collectForeignOutputAssets(
                tx.utxo?.outputs, currentAddress, currentStake, networkId
              );

              // Surface only assets that actually moved, via output ownership:
              //   - tokens routed to FOREIGN outputs = genuine sends (negative)
              //   - on a spend, own-output tokens are change and are omitted
              //   - on a pure receive (no own lovelace spent), own-output tokens
              //     are what was received (positive)
              // This is used as the PRIMARY accounting (not a fallback) because
              // received−sent netting silently over-reports change whenever an
              // own input's producing output is missing OR was stored lovelace-only
              // — both common for NFTs acquired outside the synced window. Output
              // ownership never depends on producer resolution, so change can't leak.
              const finalAssets = this.calculateRelevantAssetsFromOutputs(
                foreignSentAssets, receivedAssets, sentAmount > 0
              );

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
      (error: any) => {
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
    utxos: any[] | undefined,
    currentAddress: string,
    currentStake: string,
    networkId: number,
    isSent: boolean,
    assetsMap: Map<string, any>,
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

  /**
   * Collect native-token amounts sitting in this tx's FOREIGN (non-own) outputs —
   * the assets that genuinely left the wallet. Reads only the tx's own output list,
   * so it never depends on producer-output resolution (unlike sent-asset accounting).
   */
  private collectForeignOutputAssets(
    outputs: LoaderUtxo[] | undefined,
    currentAddress: string,
    currentStake: string,
    networkId: number
  ): Map<string, LoaderAsset> {
    const foreign = new Map<string, LoaderAsset>();
    if (!outputs?.length) return foreign;

    for (const out of outputs) {
      const isOwnAddress = out.address === currentAddress ||
        toStakeAddress(out.address, networkId) === currentStake;
      if (isOwnAddress) continue;

      for (const amount of out.amount ?? []) {
        if (amount.unit !== 'lovelace') {
          this.updateAssetMap(foreign, amount);
        }
      }
    }
    return foreign;
  }

  /**
   * Output-ownership fallback for when some consumed inputs aren't locally resolved,
   * so change tokens can't be netted away via received−sent. Surfaces only assets
   * that actually moved:
   *   - sends: tokens routed to foreign outputs (negative quantity)
   *   - receives (no own inputs spent): own-output tokens not also sent out (positive)
   * On a spend, own-output tokens are treated as change and omitted — matching a
   * user's mental model that assets returned to themselves aren't part of the tx.
   */
  private calculateRelevantAssetsFromOutputs(
    foreignSentAssets: Map<string, LoaderAsset>,
    receivedAssets: Map<string, LoaderAsset>,
    isSpend: boolean
  ): LoaderAsset[] {
    const relevant: LoaderAsset[] = [];

    foreignSentAssets.forEach((asset) => {
      relevant.push({ ...asset, quantity: -Math.abs(Number(asset.quantity)) });
    });

    if (!isSpend) {
      receivedAssets.forEach((asset, unit) => {
        if (!foreignSentAssets.has(unit)) {
          relevant.push({ ...asset, quantity: Math.abs(Number(asset.quantity)) });
        }
      });
    }
    return relevant;
  }

  private updateAssetMap(assetsMap: Map<string, any>, asset: any): void {
    const existing = assetsMap.get(asset.unit);
    if (existing) {
      existing.quantity += Number(asset.quantity);
    } else {
      assetsMap.set(asset.unit, {
        ...asset,
        quantity: Number(asset.quantity)
      });
    }
  }

  private calculateFinalAssets(sentAssets: Map<string, any>, receivedAssets: Map<string, any>): any[] {
    const finalAssets: any[] = [];
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
  private async detectAndHandleOldTransactionFormat(transactions: any[]): Promise<boolean> {
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
