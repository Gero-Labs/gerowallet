import { Psbt } from 'bitcoinjs-lib';

/** A device response may add signatures, but must keep the approved transaction. */
export function assertApprovedPsbt(requested: string, signed: string): void {
  const parse = (value: string) => /^[\da-f]+$/i.test(value)
    ? Psbt.fromHex(value)
    : Psbt.fromBase64(value);
  const approved = parse(requested).data.globalMap.unsignedTx.toBuffer();
  const returned = parse(signed).data.globalMap.unsignedTx.toBuffer();
  if (!approved.equals(returned)) throw new Error('Device response does not match the approved Bitcoin transaction');
}
