import { Cardano } from '@cardano-sdk/core';

interface TxAmount {
  unit: string;
  quantity: string;
}

interface UtxoInput {
  address: string;
  amount: TxAmount[];
  tx_hash: string;
  output_index: number;
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
  collateral: boolean;
  reference: boolean;
}

interface UtxoOutput {
  address: string;
  amount: TxAmount[];
  output_index: number;
  data_hash: string | null;
  inline_datum: string | null;
  collateral: boolean;
  reference_script_hash: string | null;
  consumed_by_tx: string | null;
}

interface TxUtxo {
  inputs: UtxoInput[];
  outputs: UtxoOutput[];
}

export interface TxAsset {
  unit: string;
  policy_id: string;
  asset_name: string;
  quantity: number;
  metadata: {
    decimals: number;
    description: string;
    logo: string;
    name: string;
    ticker: string;
  };
}

// ---------------------------------------------------------------------------
// Shared computed display fields (populated by TransactionsLoader)
// ---------------------------------------------------------------------------

interface TxDisplayFields {
  sentAmount: number;
  receivedAmount: number;
  sentAssets: TxAsset[];
  receivedAssets: TxAsset[];
  ada: number;
  assets: TxAsset[];
}

export interface CardanoTx extends TxDisplayFields {
  id: string;
  tx_hash: string;
  block_hash: string | null;
  block_height: number;
  epoch_no: number | null;
  absolute_slot: number | null;
  tx_timestamp: number; // Unix seconds
  tx_size: number;
  cbor: string;
  pending: boolean;
  utxo: TxUtxo | null; // null for pending (unconfirmed) transactions
  // Fields spread from Cardano.Tx via ...txDeserialized
  body: Cardano.TxBody;
  isValid: boolean;
  witness?: Cardano.Witness;
  auxiliaryData?: Cardano.AuxiliaryData | null;
}

// ---------------------------------------------------------------------------
// ApexTx – no CBOR, no body, several fields nullable
// ---------------------------------------------------------------------------
export interface ApexTx extends TxDisplayFields {
  id: string;
  tx_hash: string;
  block_hash: null;
  block_height: number;
  epoch_no: null;
  absolute_slot: null;
  tx_timestamp: number; // Unix seconds
  tx_size: number;
  cbor: null;
  pending: boolean;
  utxo: TxUtxo;
}

// ---------------------------------------------------------------------------
// Union + type guard
// ---------------------------------------------------------------------------

export type StoredTransaction = CardanoTx | ApexTx;

export function isCardanoTx(tx: StoredTransaction): tx is CardanoTx {
  return 'body' in tx;
}
