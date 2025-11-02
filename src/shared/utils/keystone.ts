import { purpose } from '@/models/types';
import {
  CardanoSignature,
  Curve,
  KeystoneSDK,
  MultiAccounts,
  UR,
  URDecoder,
  UREncoder,
} from '@keystonehq/keystone-sdk';
import { DerivationAlgorithm } from '@keystonehq/bc-ur-registry/src/extended/DerivationSchema';
import { Options } from 'qr-code-styling/lib/types';
import logo128Url from '@/assets/img/bkp/logo128.png';
import { Cardano, Serialization } from '@cardano-sdk/core';

const sdk: KeystoneSDK = new KeystoneSDK();

export const getKeystonePublicKeyUR = (accPurpose = purpose.hdwallet, accIndex = 0): any => {
  const ur: UR = sdk.generateKeyDerivationCall({ schemas: [ { path: `m/${accPurpose}'/1815'/${accIndex}'`, curve: Curve.ed25519, algo: DerivationAlgorithm.bip32ed25519 } ], origin: 'gerowallet' })
  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190)
}

export const parseMultiAccounts = (decodedQRCode: string): MultiAccounts => {
  return sdk.parseMultiAccounts(URDecoder.decode(decodedQRCode));
}

export const parseSignature = (decodedQRCode: string): CardanoSignature => {
  return sdk.cardano.parseSignature(URDecoder.decode(decodedQRCode));
}

export const createKeystoneSignRequest = (tx: Serialization.Transaction, walletData, utxos, addresses): any => {
  const getOwnedUtxos = (txInputs: readonly Serialization.TransactionInput[], xfp: string) => {
    const keystoneUtxos = [];
    const extraSigners = [];

    txInputs.forEach((input: Serialization.TransactionInput) => {
      const inputTxHash = input.transactionId();
      const inputTxIndex = input.index();
      const utxo = utxos.find(utxo => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);
      if (utxo) {
        keystoneUtxos.push({
          transactionHash: utxo.tx_hash,
          index: utxo.tx_index,
          amount: utxo.value,
          xfp,
          hdPath: addresses[utxo.payment_addr.bech32].path,
          address: utxo.payment_addr.bech32,
        })
      }
    });

    if ((tx.body().certs() && tx.body().certs().size() > 0) || (tx.body().withdrawals() && tx.body().withdrawals().size > 0)) {
      const credsNeeded = new Set<Cardano.Credential>();
      if (tx.body().certs()) {
        tx.body().certs().values().forEach((cert) => {
          const stakeRegistrationAndDelegation = cert.asStakeRegistrationDelegationCert();
          if (stakeRegistrationAndDelegation) {
            credsNeeded.add(stakeRegistrationAndDelegation.stakeCredential())
          }
          const stakeDelegation = cert.asStakeDelegation();
          if (stakeDelegation) {
            credsNeeded.add(stakeDelegation.stakeCredential())
          }
          const stakeDeregistration = cert.asStakeDeregistration()
          if (stakeDeregistration) {
            credsNeeded.add(stakeDeregistration.stakeCredential())
          }
          // TODO More
        })
      }
      if (tx.body().withdrawals()) {
        tx.body().withdrawals().keys().forEach((rewardAccount) => {
          const bigNum = tx.body().withdrawals().get(rewardAccount)
          if (bigNum) {
            const keyAddress = Cardano.Address.fromBech32(walletData.stakeAddress);
            credsNeeded.add(Cardano.BaseAddress.fromAddress(keyAddress).getStakeCredential())
          }
        })
      }
      credsNeeded.forEach((cred) => {
        extraSigners.push({
          keyHash: cred.hash,
          xfp,
          keyPath: "m/1852'/1815'/0'/2/0"
        });
      })
    }
    return {keystoneUtxos, extraSigners}
  }
  const xfp = walletData.xfp ?? "";
  const res = getOwnedUtxos(tx.body().inputs().values(), xfp)
  // let txInputs: TransactionInputs = tx.body().inputs();
  // // if (!txInputs) {
  // //   const { utxoList } = getFilteredUtxoList(appAccount, false);
  // //   inputUtxoList = utxoList;
  // // }
  const req = {
    origin: 'gerowallet',
    requestId: crypto.randomUUID(),
    signData: Buffer.from(tx.toCbor(), 'hex'),
    utxos: res.keystoneUtxos,
    extraSigners: res.extraSigners
  };
  return sdk.cardano.generateSignRequest(req)
}

export const qrCodeOptions = (encodedUR: string, size: number): Options => {
  return {
    width: size,
    height: size,
    data: encodedUR,
    image: logo128Url,
    type: 'svg',
    margin: 0,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'Q'
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.1,
      margin: 6,
      crossOrigin: 'anonymous',
    },
    dotsOptions: {
      // color: '#41b583',
      // gradient: {
      //   type: 'linear', // 'radial'
      //   rotation: 0,
      //   colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      // },
      type: 'rounded',
    },
    backgroundOptions: {
      color: '#ffffff',
    },
    cornersSquareOptions: {
      color: '#35495E',
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      type: 'dot',
      // gradient: {
      //   type: 'linear', // 'radial'
      //   rotation: 180,
      //   colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      // },
    }
  }
}
