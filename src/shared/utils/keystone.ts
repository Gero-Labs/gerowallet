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
import { Address, BaseAddress, Credential, Transaction, TransactionInputs } from '@emurgo/cardano-serialization-lib-browser';
import { Options } from 'qr-code-styling/lib/types';

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

export const createKeystoneSignRequest = (tx: Transaction, walletData, utxos, addresses): any => {
  const getOwnedUtxos = (txInputs: TransactionInputs, xfp: string) => {
    const keystoneUtxos = [];
    const extraSigners = [];

    for (let i = 0; i < txInputs.len(); i++) {
      const input = txInputs.get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
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
      console.log(utxo)
    }

    if ((tx.body().certs() && tx.body().certs().len() > 0) || (tx.body().withdrawals() && tx.body().withdrawals().len() > 0)) {
      const credsNeeded = new Set<Credential>();
      if (tx.body().certs()) {
        for (let i = 0 ; i < tx.body().certs().len() ; i++) {
          const cert = tx.body().certs().get(i)
          const stakeRegistrationAndDelegation = cert.as_stake_registration_and_delegation()
          if (stakeRegistrationAndDelegation) {
            credsNeeded.add(stakeRegistrationAndDelegation.stake_credential())
          }
          const stakeDelegation = cert.as_stake_delegation()
          if (stakeDelegation) {
            credsNeeded.add(stakeDelegation.stake_credential())
          }
          const stakeDeregistration = cert.as_stake_deregistration()
          if (stakeDeregistration) {
            credsNeeded.add(stakeDeregistration.stake_credential())
          }
          // TODO More
        }
      }
      if (tx.body().withdrawals()) {
        for (let i = 0 ; i < tx.body().withdrawals().len() ; i++) {
          const bigNum = tx.body().withdrawals().get(walletData.stakeAddress)
          if (bigNum) {
            const keyAddress = Address.from_bech32(walletData.stakeAddress);
            credsNeeded.add(BaseAddress.from_address(keyAddress).stake_cred())
          }
        }
      }
      credsNeeded.forEach((cred) => {
        extraSigners.push({
          keyHash: cred.to_keyhash().to_hex(),
          xfp,
          keyPath: "m/1852'/1815'/0'/2/0"
        });
      })
    }
    return {keystoneUtxos, extraSigners}
  }
  const xfp = walletData.xfp ?? "";
  const res = getOwnedUtxos(tx.body().inputs(), xfp)
  // let txInputs: TransactionInputs = tx.body().inputs();
  // // if (!txInputs) {
  // //   const { utxoList } = getFilteredUtxoList(appAccount, false);
  // //   inputUtxoList = utxoList;
  // // }
  console.log('tx', tx.to_json())
  const req = {
    origin: 'gerowallet',
    requestId: crypto.randomUUID(),
    signData: Buffer.from(tx.to_bytes()),
    utxos: res.keystoneUtxos,
    extraSigners: res.extraSigners
  };
  const req_json = JSON.parse(JSON.stringify(req));
  console.log("req_json", JSON.stringify(req_json));
  return sdk.cardano.generateSignRequest(req)
}

export const qrCodeOptions = (encodedUR: string, size: number): Options => {
  return {
    width: size,
    height: size,
    data: encodedUR,
    image: require('@/assets/img/bkp/logo128.png'),
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
