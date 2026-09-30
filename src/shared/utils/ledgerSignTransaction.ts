import {
  BIP32Path,
  DatumType,
  DeviceStatusCodes,
  TransactionSigningMode,
  TxOutput,
  TxOutputFormat,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent, toLedgerTx } from '@cardano-sdk/hardware-ledger';
import {
  Cip1852PathLevelIndexes,
  errors,
  KeyPurpose,
  KeyRole,
  SerializableLedgerKeyAgentData,
  SignTransactionContext,
  util,
} from '@cardano-sdk/key-management';
import { areStringsEqualInConstantTime } from '@cardano-sdk/util';

/** The multisig witness LedgerKeyAgent asks the device for. */
const multiSigWitnessPaths: BIP32Path[] = [
  util.accountKeyDerivationPathToBip32Path(0, { index: 0, role: KeyRole.External }, KeyPurpose.MULTI_SIG),
];

const outputFormat = (output: Serialization.TransactionOutput | undefined): TxOutputFormat =>
  output?.isBabbageOutput() ? TxOutputFormat.MAP_BABBAGE : TxOutputFormat.ARRAY_LEGACY;

/**
 * Whether LedgerKeyAgent would send this output's inline datum or reference script with other
 * bytes than the transaction's: it rebuilds both from the Core value, as below.
 */
const agentReencodes = (output: Serialization.TransactionOutput): boolean => {
  const { datum, scriptReference } = output.toCore();
  const inlineDatum = output.datum()?.asInlineData();
  const script = output.scriptRef();
  return (
    (!!inlineDatum && !!datum && Serialization.PlutusData.fromCore(datum).toCbor() !== inlineDatum.toCbor()) ||
    (!!script && !!scriptReference && Serialization.Script.fromCore(scriptReference).toCbor() !== script.toCbor())
  );
};

/** The agent's device output, over the inline datum and reference script bytes of `output`. */
const withOriginalBytes = (ledgerOutput: TxOutput, output: Serialization.TransactionOutput): TxOutput => {
  if (ledgerOutput.format !== TxOutputFormat.MAP_BABBAGE) return ledgerOutput;
  const inlineDatum = output.datum()?.asInlineData();
  const script = output.scriptRef();
  return {
    ...ledgerOutput,
    ...(inlineDatum && { datum: { type: DatumType.INLINE, datumHex: inlineDatum.toCbor() } }),
    ...(script && { referenceScriptHex: script.toCbor() }),
  };
};

/**
 * `LedgerKeyAgent.signTransaction`, except that the device gets the body the transaction holds:
 * every output's inline datum and reference script as the bytes they have in it, and a testnet
 * body's network id.
 *
 * The agent maps outputs from `txBody.toCore()` and re-encodes both from the Core value
 * (`PlutusData.fromCore(datum).toCbor()`, `TransactionOutput.fromCore(txOut).scriptRef()`). That
 * changes any not in the SDK's own encoding, a definite-length list datum for one. It also maps
 * `includeNetworkId: !!networkId`, which leaves out a testnet's network id, 0. Either way the device
 * hashes a different body and the agent throws "Ledger computed a different transaction id". That
 * is so in @cardano-sdk/hardware-ledger 0.17.0 (input-output-hk/cardano-js-sdk#1758), and nothing
 * here waits for upstream: this path is the wallet's own. ledgerSignTransaction.spec.ts compares
 * its device request with the agent's, so an upgrade that changes the agent fails there.
 *
 * Only such a transaction takes the path below, a copy of the agent's own with those put back:
 * every other transaction is the agent's to sign, unchanged.
 */
export async function signLedgerTransaction(
  agent: LedgerKeyAgent,
  txBody: Serialization.TransactionBody,
  { knownAddresses, txInKeyPathMap }: SignTransactionContext,
): Promise<Cardano.Signatures> {
  const body = txBody.toCore();
  const outputs = txBody.outputs();
  const collateralReturn = txBody.collateralReturn();
  if (
    !outputs.some(agentReencodes) &&
    !(collateralReturn && agentReencodes(collateralReturn)) &&
    body.networkId !== Cardano.NetworkId.Testnet
  ) {
    return agent.signTransaction(txBody, { knownAddresses, txInKeyPathMap });
  }

  try {
    const hash = txBody.hash();
    const dRepPublicKey = await agent.derivePublicKey(util.DREP_KEY_DERIVATION_PATH);
    const dRepKeyHashHex = (await Crypto.Ed25519PublicKey.fromHex(dRepPublicKey).hash()).hex();
    const tx = await toLedgerTx(body, {
      accountIndex: agent.accountIndex,
      chainId: agent.chainId,
      collateralReturnFormat: outputFormat(collateralReturn),
      dRepKeyHashHex,
      knownAddresses,
      outputsFormat: outputs.map(outputFormat),
      txInKeyPathMap,
    });
    tx.outputs = tx.outputs.map((ledgerOutput, index) => withOriginalBytes(ledgerOutput, outputs[index]));
    if (tx.collateralOutput && collateralReturn) tx.collateralOutput = withOriginalBytes(tx.collateralOutput, collateralReturn);
    tx.includeNetworkId = body.networkId !== undefined;

    const { communicationType } = agent.serializableData as SerializableLedgerKeyAgentData;
    const deviceConnection = await LedgerKeyAgent.checkDeviceConnection(communicationType, agent.deviceConnection);
    const signingMode = LedgerKeyAgent.getSigningMode(tx);
    const result = await deviceConnection.signTransaction({
      options: { tagCborSets: txBody.hasTaggedSets() },
      signingMode,
      tx,
      ...(signingMode === TransactionSigningMode.MULTISIG_TRANSACTION && { additionalWitnessPaths: multiSigWitnessPaths }),
    });
    if (!areStringsEqualInConstantTime(result.txHashHex, hash)) {
      throw new errors.HwMappingError('Ledger computed a different transaction id');
    }

    return new Map(
      await Promise.all(
        result.witnesses.map(async (witness): Promise<[Crypto.Ed25519PublicKeyHex, Crypto.Ed25519SignatureHex]> => [
          await agent.derivePublicKey({
            index: witness.path[Cip1852PathLevelIndexes.INDEX],
            role: witness.path[Cip1852PathLevelIndexes.ROLE],
          }),
          Crypto.Ed25519SignatureHex(witness.witnessSignatureHex),
        ]),
      ),
    );
  } catch (error) {
    // The agent's error mapping.
    if ((error as { code?: number } | null)?.code === DeviceStatusCodes.ERR_REJECTED_BY_USER) {
      throw new errors.AuthenticationError('Transaction signing aborted', error);
    }
    throw new errors.TransportError('Ledger transport failed', error);
  }
}
