import {
  Ada,
  BIP32Path,
  DatumType,
  DeviceStatusCodes,
  TransactionSigningMode,
  TxOutput,
  TxOutputFormat,
  Witness,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent, toLedgerTx } from '@cardano-sdk/hardware-ledger';
import {
  Bip32Account,
  CardanoKeyConst,
  errors,
  KeyPurpose,
  KeyRole,
  SerializableLedgerKeyAgentData,
  SignTransactionContext,
  util,
} from '@cardano-sdk/key-management';
import { areStringsEqualInConstantTime } from '@cardano-sdk/util';

/**
 * The multisig witness to ask the device for: the CIP-1854 key of the wallet's own account.
 * LedgerKeyAgent always asks for account 0's, which is the right key only on account #0.
 */
const multiSigWitnessPaths = (accountIndex: number): BIP32Path[] => [
  util.accountKeyDerivationPathToBip32Path(accountIndex, { index: 0, role: KeyRole.External }, KeyPurpose.MULTI_SIG),
];

/**
 * The public key each witness the device returns is paired with, read from the witness's own
 * path. LedgerKeyAgent derives every witness under its 1852' account key, so it pairs a CIP-1854
 * multisig signature with the 1852' key at the same role and index: a key that did not make it,
 * and the witness never verifies (issue 1347). Here a 1852' witness takes the agent's key, as
 * before; a 1854' witness takes the multisig account key, which the wallet does not store, so the
 * device exports it the first time one comes back. Both only at the wallet's own account, the
 * only one it asks the device to sign with: any other witness is refused.
 */
const witnessPublicKeys = (agent: LedgerKeyAgent, deviceConnection: Pick<Ada, 'getExtendedPublicKey'>) => {
  let multiSigAccount: Promise<Bip32Account> | undefined;
  const exportMultiSigAccount = async (): Promise<Bip32Account> => {
    const { publicKeyHex, chainCodeHex } = await deviceConnection.getExtendedPublicKey({
      path: [util.harden(KeyPurpose.MULTI_SIG), util.harden(CardanoKeyConst.COIN_TYPE), util.harden(agent.accountIndex)],
    });
    return new Bip32Account(
      {
        accountIndex: agent.accountIndex,
        chainId: agent.chainId,
        extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(`${publicKeyHex}${chainCodeHex}`),
      },
      { bip32Ed25519: agent.bip32Ed25519, blake2b: Crypto.blake2b },
    );
  };

  return async ({ path }: Witness): Promise<Crypto.Ed25519PublicKeyHex> => {
    const [purpose, coinType, account, role, index] = path;
    const ownAccount =
      path.length === 5 &&
      coinType === util.harden(CardanoKeyConst.COIN_TYPE) &&
      account === util.harden(agent.accountIndex);
    if (ownAccount && purpose === util.harden(KeyPurpose.STANDARD)) {
      return agent.derivePublicKey({ index, role });
    }
    if (ownAccount && purpose === util.harden(KeyPurpose.MULTI_SIG)) {
      multiSigAccount ??= exportMultiSigAccount();
      return (await multiSigAccount).derivePublicKey({ index, role });
    }
    throw new errors.HwMappingError('Ledger returned a witness for a key the wallet did not ask for');
  };
};

/** The agent's error mapping. */
const agentError = (error: unknown): Error =>
  (error as { code?: number } | null)?.code === DeviceStatusCodes.ERR_REJECTED_BY_USER
    ? new errors.AuthenticationError('Transaction signing aborted', error)
    : new errors.TransportError('Ledger transport failed', error);

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
 * Only such a transaction takes the path below, a copy of the agent's own with those put back,
 * and so does every multisig-mode transaction, on account #0 too: the agent asks for account 0's
 * multisig witness path whatever the account, and pairs the multisig witness with a 1852' key
 * (see witnessPublicKeys). Every other transaction is the agent's to sign, unchanged.
 */
export async function signLedgerTransaction(
  agent: LedgerKeyAgent,
  txBody: Serialization.TransactionBody,
  { knownAddresses, txInKeyPathMap }: SignTransactionContext,
): Promise<Cardano.Signatures> {
  const body = txBody.toCore();
  const outputs = txBody.outputs();
  const collateralReturn = txBody.collateralReturn();
  const agentSendsBody =
    !outputs.some(agentReencodes) &&
    !(collateralReturn && agentReencodes(collateralReturn)) &&
    body.networkId !== Cardano.NetworkId.Testnet;

  let hash: string;
  let tx: Awaited<ReturnType<typeof toLedgerTx>>;
  try {
    hash = txBody.hash();
    const dRepPublicKey = await agent.derivePublicKey(util.DREP_KEY_DERIVATION_PATH);
    const dRepKeyHashHex = (await Crypto.Ed25519PublicKey.fromHex(dRepPublicKey).hash()).hex();
    tx = await toLedgerTx(body, {
      accountIndex: agent.accountIndex,
      chainId: agent.chainId,
      collateralReturnFormat: outputFormat(collateralReturn),
      dRepKeyHashHex,
      knownAddresses,
      outputsFormat: outputs.map(outputFormat),
      txInKeyPathMap,
    });
  } catch (error) {
    throw agentError(error);
  }
  const signingMode = LedgerKeyAgent.getSigningMode(tx);
  if (agentSendsBody && signingMode !== TransactionSigningMode.MULTISIG_TRANSACTION) {
    return agent.signTransaction(txBody, { knownAddresses, txInKeyPathMap });
  }

  try {
    tx.outputs = tx.outputs.map((ledgerOutput, index) => withOriginalBytes(ledgerOutput, outputs[index]));
    if (tx.collateralOutput && collateralReturn) tx.collateralOutput = withOriginalBytes(tx.collateralOutput, collateralReturn);
    tx.includeNetworkId = body.networkId !== undefined;

    const { communicationType } = agent.serializableData as SerializableLedgerKeyAgentData;
    const deviceConnection = await LedgerKeyAgent.checkDeviceConnection(communicationType, agent.deviceConnection);
    const result = await deviceConnection.signTransaction({
      options: { tagCborSets: txBody.hasTaggedSets() },
      signingMode,
      tx,
      ...(signingMode === TransactionSigningMode.MULTISIG_TRANSACTION && {
        additionalWitnessPaths: multiSigWitnessPaths(agent.accountIndex),
      }),
    });
    if (!areStringsEqualInConstantTime(result.txHashHex, hash)) {
      throw new errors.HwMappingError('Ledger computed a different transaction id');
    }

    const witnessPublicKey = witnessPublicKeys(agent, deviceConnection);
    return new Map(
      await Promise.all(
        result.witnesses.map(async (witness): Promise<[Crypto.Ed25519PublicKeyHex, Crypto.Ed25519SignatureHex]> => [
          await witnessPublicKey(witness),
          Crypto.Ed25519SignatureHex(witness.witnessSignatureHex),
        ]),
      ),
    );
  } catch (error) {
    throw agentError(error);
  }
}
