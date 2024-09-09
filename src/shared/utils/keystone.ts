import { purpose } from '@/models/types';
import { Curve, KeystoneSDK, UR, URDecoder, UREncoder } from '@keystonehq/keystone-sdk';
import { DerivationAlgorithm } from '@keystonehq/bc-ur-registry/src/extended/DerivationSchema';

const sdk: KeystoneSDK = new KeystoneSDK();

export const getKeystonePublicKeyUR = (accPurpose = purpose.hdwallet, accIndex = 0): any => {
  const ur: UR = sdk.generateKeyDerivationCall({ schemas: [ { path: `m/${accPurpose}'/1815'/${accIndex}'`, curve: Curve.ed25519, algo: DerivationAlgorithm.bip32ed25519 } ], origin: 'gerowallet' })
  return qrCodeOptions(UREncoder.encodeSinglePart(ur))
}

export const parseMultiAccounts = (decodedQRCode: string) => {
  return sdk.parseMultiAccounts(URDecoder.decode(decodedQRCode))
}

// export const createKeystoneSignRequest = async (appAccount, walletData, txBuildRes, credList) => {
//   if (!(txBuildRes == null ? void 0 : txBuildRes.builtTx)) {
//     throw ErrorSignTx.missingTx;
//   }
//   if (!(txBuildRes == null ? void 0 : txBuildRes.txCbor)) {
//     throw ErrorSignTx.missingTx;
//   }
//   if (!credList) {
//     throw ErrorSignTx.missingKeysList;
//   }
//   const xfp = walletData.wallet.masterFingerprint ?? "";
//   const tx = txBuildRes.builtTx;
//   let inputUtxoList = tx.inputUtxoList;
//   if (!inputUtxoList) {
//     const { utxoList } = getFilteredUtxoList(appAccount, false);
//     inputUtxoList = utxoList;
//   }
//   const req = {
//     origin,
//     requestId: getRandomUUID(),
//     signData: toHexBuffer(txBuildRes.txCbor),
//     utxos: getOwnedUtxos(appAccount.data, xfp, tx.body.inputs, inputUtxoList),
//     extraSigners: getExtraSigners(appAccount.data, xfp, credList, tx.body.inputs, inputUtxoList)
//   };
//   const req_json = JSON.parse(JSON.stringify(req));
//   console.log("req_json", JSON.stringify(req_json));
//   console.log("req_json", req_json);
//   txBuildRes.hwRequest = req_json;
//   return sdk.cardano.generateSignRequest(req);
// }

const qrCodeOptions = (encodedUR: string): any=> {
  return {
    width: 190,
    height: 190,
    data: encodedUR,
    image: require('@/assets/img/bkp/logo128.png'),
    type: 'svg',
    margin: 0,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.4,
      margin: 6,
      crossOrigin: 'anonymous',
    },
    dotsOptions: {
      // color: '#41b583',
      gradient: {
        type: 'linear', // 'radial'
        rotation: 0,
        colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      },
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
      gradient: {
        type: 'linear', // 'radial'
        rotation: 180,
        colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      },
    }
  }
}
