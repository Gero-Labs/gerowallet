import { TransactionBody, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';

export default {

  async txToTrezor(txBody: TransactionBody, address: string, index = 0, isDapp?: boolean, usedUtxos?: any[]): Promise<Uint8Array | TransactionWitnessSet> {
    // const trezorPaymentKey = {path: "m/1852'/1815'/0'/0/0", hash: await this.addrToPaymentKeyHash()};
    const trezorStakingKey = {path: "m/1852'/1815'/0'/2/0"};
    return undefined;
  },
}
