import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import {
  toPaymentCredential,
  toStakeCredential
} from '@/chrome/serialization';

export function convertToTxSchema(txId: string, txCbor: string, utxos: any[], networkId: number): any {
  const tx: Cardano.Tx = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor));
  const inputs: any[] = [];
  tx.body.inputs.forEach((input: Cardano.TxIn) => {
    const utxo = utxos.find(utxo => utxo.tx_hash === input.txId && utxo.tx_index === input.index)
    if (utxo) {
      inputs.push(utxo)
    }
  })
  const outputs: any[] = [];
  let index: number = 0;
  let totalOutput: bigint = BigInt(0);
  tx.body.outputs.forEach((output: Cardano.TxOut) => {
    let stakeAddress = null
    try {
      const stakeCred: Cardano.Credential = toStakeCredential(Cardano.Address.fromBech32(output.address));
      stakeAddress = Cardano.RewardAddress.fromCredentials(networkId, stakeCred).toAddress().toBech32();
    } catch (e) {
      console.log(e)
    }
    totalOutput = totalOutput + output.value.coins
    const asset_list = []
    const multiAsset: Cardano.TokenMap = output.value.assets;
    if (multiAsset) {
      multiAsset.forEach((quantity, assetId) => {
        asset_list.push({
          policy_id: Cardano.AssetId.getPolicyId(assetId),
          asset_name: Cardano.AssetId.getAssetName(assetId),
          quantity: quantity,
        });
      })
    }
    const outputRes: any = {
      asset_list,
      payment_addr: {
        bech32: output.address,
        cred: toPaymentCredential(Cardano.Address.fromBech32(output.address)).hash
      },
      reference_script: output.scriptReference,
      stake_addr: stakeAddress,
      tx_hash: txId,
      tx_index: index++,
      value: output.value.coins.toString()
    }
    if (output.datumHash) {
      outputRes.datum_hash = output.datumHash;
    }
    if (output.datum) {
      outputRes.inline_datum = output.datum;
    }
    if (output.scriptReference) {
      outputRes.reference_script = output.scriptReference;
    }
    outputs.push(outputRes);
  })
  const assets_minted: any[] = []
  if (tx.body.mint && tx.body.mint.size > 0) {
    tx.body.mint.entries().forEach(([assetId, quantity]) => {
      const policyId: Cardano.PolicyId = Cardano.AssetId.getPolicyId(assetId);
      const assetName: Cardano.AssetName = Cardano.AssetId.getAssetName(assetId);
      assets_minted.push({
        decimals: 0,
        policy_id: policyId,
        asset_name: assetName,
        quantity: quantity.toString(),
        fingerprint: Cardano.AssetFingerprint.fromParts(policyId, Cardano.AssetName(assetName))
      })
    })
  }
  const certificates: any[] = []
  if (tx.body.certificates?.length > 0) {
    let index: number = 0;
    tx.body.certificates.forEach((cert: Cardano.Certificate) => {
      if (cert.__typename === Cardano.CertificateType.StakeRegistration) {
        certificates.push({
          index: index++,
          info: {
            deposit: "2000000", // TODO value should be taken from epoch parameters
            stake_address: Cardano.RewardAddress.fromCredentials(networkId, {
              type: cert.stakeCredential.type,
              hash: cert.stakeCredential.hash
            }).toAddress().toBech32()
          },
          type: 'stake_registration'
        })
      } else if (cert.__typename === Cardano.CertificateType.StakeDeregistration) {
        certificates.push({
          index: index++,
          info: {
            stake_address: Cardano.RewardAddress.fromCredentials(networkId, {
              type: cert.stakeCredential.type,
              hash: cert.stakeCredential.hash
            }).toAddress().toBech32(),
            hash: cert.stakeCredential.hash
          },
          type: 'stake_deregistration'
        })
      } else if (cert.__typename === Cardano.CertificateType.StakeDelegation) {
        certificates.push({
          index: index++,
          info: {
            pool_id_bech32: cert.poolId,
            pool_id_hex: Cardano.PoolId.toKeyHash(cert.poolId),
            stake_address: Cardano.RewardAddress.fromCredentials(networkId, {
              type: Cardano.CredentialType.KeyHash,
              hash: cert.stakeCredential.hash
            }).toAddress().toBech32()
          },
          type: 'pool_delegation'
        })
      } else if (cert.__typename === Cardano.CertificateType.PoolRegistration) {
        certificates.push({
          index: index++,
          info: {
            poolParameters: cert.poolParameters,
          },
          type: 'pool_registration'
        })
      } else if (cert.__typename === Cardano.CertificateType.VoteDelegation && Cardano.isDRepCredential(cert.dRep)) {
        const credential: Cardano.Credential = cert.dRep
        certificates.push({
          index: index++,
          info: {
            drep_hex: Ed25519KeyHashHex(cert.dRep.hash),
            drep_id: Cardano.DRepID.cip129FromCredential(credential),
            stake_address: Cardano.RewardAddress.fromCredentials(
              networkId,
              {
                type: Cardano.CredentialType.KeyHash,
                hash: cert.stakeCredential.hash
              }
            ).toAddress().toBech32()
          },
          type: 'vote_delegation'
        })
      } else {
        console.log(cert)
      }
    })
  }
  const native_scripts: Cardano.Script[] = []
  const plutus_scripts: Cardano.Script[] = []
  if (tx.auxiliaryData?.scripts?.length > 0) {
    tx.auxiliaryData?.scripts.forEach((script: Cardano.Script) => {
      if (script.__type === Cardano.ScriptType.Native) {
        native_scripts.push(script);
      } else if (script.__type == Cardano.ScriptType.Plutus) {
        plutus_scripts.push(script)
      }
    })
  }
  const reference_inputs: Cardano.TxIn[] = tx.body.referenceInputs ? tx.body.referenceInputs : []
  const withdrawals: Cardano.Withdrawal[] = tx.body.withdrawals ? tx.body.withdrawals : []
  return {
    absolute_slot: 0,
    assets_minted,
    block_hash: '',
    block_height: 0,
    // certificates,
    // deposit: "0",
    fee: tx.body.fee.toString(),
    inputs,
    invalid_after: "",
    invalid_before: '',
    metadata: tx.auxiliaryData?.blob,
    native_scripts,
    outputs,
    plutus_scripts,
    reference_inputs,
    total_output: totalOutput.toString(),
    tx_hash: txId,
    tx_size: 0,
    tx_timestamp: (new Date()).getTime() / 1000,
    withdrawals,
    pending: true
  }
}
