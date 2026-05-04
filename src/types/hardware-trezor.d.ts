/**
 * Type declarations for @cardano-sdk/hardware-trezor internal exports
 * These are not officially exported but are needed for our implementation
 */

declare module '@cardano-sdk/hardware-trezor/dist/cjs/transformers/tx' {
  import { Cardano } from '@cardano-sdk/core';
  import * as Trezor from '@trezor/connect';

  export interface TrezorTxTransformerContext {
    accountIndex: number;
    chainId: {
      networkId: number;
      networkMagic: number;
    };
    collateralReturnFormat?: Trezor.PROTO.CardanoTxOutputSerializationFormat;
    knownAddresses: any[];
    outputsFormat?: Trezor.PROTO.CardanoTxOutputSerializationFormat[];
    tagCborSets?: boolean;
    txInKeyPathMap: any;
  }

  export function txToTrezor(
    body: Cardano.TxBody,
    context: TrezorTxTransformerContext
  ): Promise<Omit<Trezor.CardanoSignTransaction, 'signingMode' | 'derivationType'>>;
}

declare module '@cardano-sdk/hardware-trezor/dist/esm/transformers/tx' {
  export * from '@cardano-sdk/hardware-trezor/dist/cjs/transformers/tx';
}