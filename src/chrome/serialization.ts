import { Asset as AssetType, Blockchain, ChainDerivations, Network, Paginate, UTxO } from '@/models/types';
import { APIError, DataSignError, POPUP_WINDOW, STORAGE } from './config';
import networks from '@/utils/networks';
import {
  Bip32PrivateKey,
  Bip32PublicKey,
  Ed25519KeyHash,
  Ed25519KeyHashHex,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  Hash28ByteBase16,
  Hash32ByteBase16,
} from '@cardano-sdk/crypto';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { bech32, bech32m } from 'bech32';
import { Buffer } from 'buffer';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

export function convertToTxSchema(txId: string, txCbor: string, utxos: any[], networkId: number): any {
  const tx: Cardano.Tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).toCore();
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
  if (tx.body.mint) {
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
      if (cert.__typename === Cardano.CertificateType.StakeDeregistration) {
        certificates.push({
          index: index++,
          info: {
            stake_address: Cardano.RewardAddress.fromCredentials(networkId, {
              type: cert.stakeCredential.type,
              hash: cert.stakeCredential.hash
            }).toAddress().toBech32()
          },
          type: 'stake_deregistration'
        })
      } else if (cert.__typename === Cardano.CertificateType.StakeRegistration) {
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

  tx.auxiliaryData?.scripts.forEach((script: Cardano.Script) => {
    if (script.__type === Cardano.ScriptType.Native) {
      native_scripts.push(script);
    } else if (script.__type == Cardano.ScriptType.Plutus) {
      plutus_scripts.push(script)
    }
  })
  const reference_inputs: Cardano.TxIn[] = tx.body.referenceInputs ? tx.body.referenceInputs : []
  const withdrawals: Cardano.Withdrawal[] = tx.body.withdrawals ? tx.body.withdrawals : []
  return {
    absolute_slot: 0,
    assets_minted,
    block_hash: '',
    block_height: 0,
    certificates,
    deposit: "0",
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

export function jsonToPlutusData(jsonObj): Serialization.PlutusData {
  function parsePlutusData(data): Serialization.PlutusData {
    if ('bytes' in data) {
      return Serialization.PlutusData.newBytes(Buffer.from(data.bytes, 'hex'));
    } else if (data.int !== undefined) {
      return Serialization.PlutusData.newInteger(BigInt(data.int.toString()));
    } else if (data.list) {
      const plutusList: Serialization.PlutusList = new Serialization.PlutusList();
      data.list.forEach(item => {
        plutusList.add(parsePlutusData(item));
      });
      return Serialization.PlutusData.newList(plutusList);
    } else if (data.map) {
      const plutusMap: Serialization.PlutusMap = new Serialization.PlutusMap();
      data.map.forEach(item => {
        const key: Serialization.PlutusData = parsePlutusData(item.k);
        const value: Serialization.PlutusData = parsePlutusData(item.v);
        plutusMap.insert(key, value);
      });
      return Serialization.PlutusData.newMap(plutusMap);
    } else if (data.constructor !== undefined && data.fields) {
      const constrFields: Serialization.PlutusList = new Serialization.PlutusList();
      data.fields.forEach(field => {
        constrFields.add(parsePlutusData(field));
      });
      return Serialization.PlutusData.newConstrPlutusData(
        new Serialization.ConstrPlutusData(
          BigInt(data.constructor.toString()),
          constrFields
        )
      );
    } else {
      throw new Error('Unsupported Plutus Data format');
    }
  }
  return parsePlutusData(jsonObj);
}

export function isPaymentAddress(address: string): boolean {
  return Cardano.Address.isValid(address) || Cardano.Address.isValidByron(address);
}

export function isPaymentAddressOrHandle(address: string): boolean {
  return Cardano.Address.isValid(address) || Cardano.Address.isValidByron(address) || (address.startsWith('$') && address.length > 1);
}

export function resolvePrivatePaymentKey(decodedHash: Buffer, keyIndex: number): Ed25519PrivateKey {
  const prvRootKeyBech32: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);
  return prvRootKeyBech32.derive([ChainDerivations.EXTERNAL, keyIndex]).toRawKey();
}

export function toValue(assets: any[], lovelace: string): Serialization.Value {
  const tokenMap = assets.reduce((map, asset) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current = map.get(assetId) ?? BigInt(0);
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());
  return new Serialization.Value(BigInt(lovelace), tokenMap)
}

export function toStakeCredential(address: Cardano.Address): Cardano.Credential {
  return Cardano.BaseAddress.fromAddress(address)?.getStakeCredential();
}

export function toPaymentCredential(address: Cardano.Address): Cardano.Credential {
  try {
    const baseAddress: Cardano.BaseAddress = Cardano.BaseAddress.fromAddress(address)
    if (baseAddress)
      return baseAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const enterpriseAddress: Cardano.EnterpriseAddress = Cardano.EnterpriseAddress.fromAddress(address)
    if (enterpriseAddress)
      return enterpriseAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const pointerAddress: Cardano.PointerAddress = Cardano.PointerAddress.fromAddress(address)
    if (pointerAddress)
      return pointerAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const rewardAddress: Cardano.RewardAddress = Cardano.RewardAddress.fromAddress(address)
    if (rewardAddress)
      return rewardAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  return undefined;
}

export function paymentKeyHash(pubKey: Bip32PublicKey, index: number): Ed25519KeyHash {
  return pubKey
    .derive([ChainDerivations.EXTERNAL, index])
    .toRawKey()
    .hash();
}

export function stakeKeyHash(pubKey: Bip32PublicKey, index: number): Ed25519KeyHash {
  return pubKey
    .derive([ChainDerivations.CHIMERIC_ACCOUNT, index])
    .toRawKey()
    .hash();
}

export function getAddress(xpub: string, chain: string, network: string, index: number = 0): Cardano.Address {
  const networkId = networks.resolveNetworkId(chain, network);
  const pubKey = getPublicKey(xpub);
  return buildBaseAddress(networkId,
    Hash28ByteBase16.fromEd25519KeyHashHex(paymentKeyHash(pubKey, index).hex()),
    Hash28ByteBase16.fromEd25519KeyHashHex(stakeKeyHash(pubKey, 0).hex())).toAddress();
}

export function buildBaseAddress(networkId: Cardano.NetworkId, paymentKeyHash: Hash28ByteBase16, stakeKeyHash: Hash28ByteBase16) {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    {
      hash: paymentKeyHash,
      type: Cardano.CredentialType.KeyHash
    },
    {
      hash: stakeKeyHash,
      type: Cardano.CredentialType.KeyHash
    }
  );
}

export function buildEnterpriseAddress(networkId: Cardano.NetworkId, paymentKeyHash: Hash28ByteBase16) {
  return Cardano.EnterpriseAddress.fromCredentials(networkId, {
    hash: paymentKeyHash,
    type: Cardano.CredentialType.KeyHash
  });
}

export function buildRewardAddress(networkId: Cardano.NetworkId, stakeKeyHash: Hash28ByteBase16) {
  return Cardano.RewardAddress.fromCredentials(networkId, {
    type: Cardano.CredentialType.KeyHash,
    hash: stakeKeyHash
  });
}

export function getUtxos(
  amount: string = undefined,
  paginate: Paginate = undefined,
  utxos: any[],
  collateral: any
): Serialization.TransactionUnspentOutput[] {

  // Exclude collateral input from the overall UTXO set
  if (collateral) {
    utxos = utxos.filter(
      (utxo) =>
        !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index)
    );
  }

  // Convert raw UTXOs to the appropriate format
  const converted: Serialization.TransactionUnspentOutput[] = utxos.map((utxo) => toUTxO(utxo));

  // If no amount is specified, return all UTXOs (with optional pagination)
  if (!amount) {
    if (paginate) {
      const start = paginate.page * paginate.limit;
      const end = start + paginate.limit;
      return converted.slice(start, end);
    }
    return converted;
  }

  // Parse the target value from the provided hex string
  let targetValue: Serialization.Value;
  try {
    targetValue = Serialization.Value.fromCbor(HexBlob(amount));
  } catch (e) {
    throw APIError.InvalidRequest;
  }

  // Determine if the target is pure ADA (i.e. no multiassets)
  const targetMultiasset = targetValue.multiasset();
  const isPureTarget: boolean = !targetMultiasset || targetMultiasset.size === 0;

  // Separate UTXOs into pure ADA and those with multiassets
  const pureUtxos: Serialization.TransactionUnspentOutput[] = [];
  const multiUtxos: Serialization.TransactionUnspentOutput[] = [];
  for (const utxo of converted) {
    const utxoValue = utxo.output().amount();
    const ma = utxoValue.multiasset();
    if (!ma || ma.size === 0) {
      pureUtxos.push(utxo);
    } else {
      multiUtxos.push(utxo);
    }
  }

  const selectedUtxos: Serialization.TransactionUnspentOutput[] = [];
  let accumulatedValue: Serialization.Value = new Serialization.Value(BigInt(0));

  if (isPureTarget) {
    // --- Try to accumulate from pure ADA UTXOs first ---
    pureUtxos.sort((a, b) => {
      const aAda = a.output().amount().coin();
      const bAda = b.output().amount().coin();
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });

    for (const utxo of pureUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
      // Break if we've reached or exceeded the target value
      if (accumulatedValue.coin() >= targetValue.coin()) {
        break;
      }
    }

    // --- If pure ADA UTXOs were insufficient, add multiasset UTXOs ---
    if (accumulatedValue.coin() < targetValue.coin()) {
      multiUtxos.sort((a, b) => {
        const aAda = a.output().amount().coin();
        const bAda = b.output().amount().coin();
        return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
      });
      for (const utxo of multiUtxos) {
        selectedUtxos.push(utxo);
        accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
        if (accumulatedValue.coin() >= targetValue.coin()) {
          break;
        }
      }
    }
  } else {
    // For targets that include multiassets, accumulate from all UTXOs
    const sortedUtxos = [...converted].sort((a, b) => {
      const aAda = BigInt(a.output().amount().coin());
      const bAda = BigInt(b.output().amount().coin());
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
      if (accumulatedValue.coin() >= targetValue.coin()) {
        break;
      }
    }
  }

  // If we couldn't accumulate enough value, return null
  if (accumulatedValue.coin() < targetValue.coin()) {
    return null;
  }

  // Apply pagination if provided
  if (paginate) {
    const start = paginate.page * paginate.limit;
    const end = start + paginate.limit;
    return selectedUtxos.slice(start, end);
  }

  return selectedUtxos;
}

export function getBalance(utxos: any[], collateral: any): Serialization.Value {
  const assets: any[] = []
  let lovelace = 0;
  if (collateral) {
    utxos = utxos.filter(utxo => !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index))
  }
  utxos.forEach(utxo => {
    assets.push(...utxo.asset_list)
    lovelace += Number(utxo.value)
  })
  return toValue(assets, lovelace.toString());
}

export function coalesceValueQuantities(quantities: Serialization.Value[]): Serialization.Value {
  const value: Serialization.Value = new Serialization.Value(BigInt(0), new Map<Cardano.AssetId, bigint>());
  quantities.forEach((val: Serialization.Value) => {
    value.setCoin(value.coin() + val.coin());
    const tokenMap = value.multiasset();
    val.multiasset()?.forEach((quantity, assetId) => {
      const current = tokenMap.get(assetId) ?? BigInt(0);
      tokenMap.set(assetId, current + quantity);
    })
    value.setMultiasset(tokenMap);
  })
  return value;
}

export function getRewardAddress(xpub: string, chain: string, network: string): Cardano.Address {
  const stakeKey = getStakeKey(xpub, 0);
  const networkId = networks.resolveNetworkId(chain, network)
  return Cardano.RewardAddress.fromCredentials(
    networkId,
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(stakeKey.hash().hex())
    }).toAddress()
}

export function getCip129DrepId(xpub: string): Cardano.DRepID {
  const drepKey = getDrepKey(xpub, 0);
  return Cardano.DRepID.cip129FromCredential(
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(drepKey.hash().hex())
    })
}

const MAX_COLLATERAL_AMOUNT = 5_000_000n;

const getFilterAsBigNum = (amount: string): bigint => {
  const reader = new Serialization.CborReader(HexBlob(amount));

  if (
    reader.peekState() === Serialization.CborReaderState.Tag &&
    reader.peekTag() === Serialization.CborTag.UnsignedBigNum
  ) {
    reader.readTag();
    return BigInt(`0x${HexBlob.fromBytes(reader.readByteString())}`).valueOf();
  }

  return reader.readInt();
};

const getFilterAmount = (amount: string): bigint => {
    const filterAmount = getFilterAsBigNum(amount);

    if (filterAmount > MAX_COLLATERAL_AMOUNT) {
      const error = APIError.InvalidRequest;
      error.info = 'The Requested Amount is Too Big';
      throw error
    }
    return filterAmount;
};

export function getCollateral({ amount = new Serialization.Value(MAX_COLLATERAL_AMOUNT).toCbor() }: { amount?: string } = {}, storedUtxos: any[]): string[] {
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }
  let filteredUtxos = storedUtxos.filter(utxo => Array.isArray(utxo.asset_list) && utxo.asset_list.length === 0)
  if (filteredUtxos.length === 0) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }
  if (amount) {
    let filterAmount = MAX_COLLATERAL_AMOUNT;
    try {
      filterAmount = getFilterAmount(amount);
    } catch (e) {
      const error = APIError.InternalError;
      error.info = (e as Error)?.message || 'Unknown error';
      throw error;
    }
    const utxos = [];
    let totalCoins = 0n;
    for (const utxo of filteredUtxos) {
      const coin = utxo.value;
      totalCoins += BigInt(coin);
      utxos.push(utxo);
      if (totalCoins >= filterAmount) break;
    }
    if (totalCoins < filterAmount) {
      const error = APIError.Refused;
      error.info = 'not enough coins in configured collateral UTxOs';
      throw error
    }
    filteredUtxos = utxos;
  }
  return filteredUtxos.map((utxo) => toUTxO(utxo).toCbor());
}

export function getUsedAddresses(addresses: {}, paginate?: Paginate): HexBlob[] {
  let res: HexBlob[] = []
  const addressesArray: any[] = Object.values(addresses)
  if (addressesArray && Array.isArray(addressesArray)) {
    addressesArray.sort((a,b) => (a['path'] > b['path']) ? 1 : ((b['path'] > a['path']) ? -1 : 0))
    const addressesArrayHex: HexBlob[] = addressesArray.map(el => Cardano.Address.fromBech32(el['address']).toBytes())
    res = paginateArray(addressesArrayHex, paginate);
  }
  return res
}

export function getUnusedAddresses(xpub: string, chain: string, network: string, addresses: {}): HexBlob[] {
  console.debug('getting unused addresses');
  let addressesArray: any[] = Object.values(addresses)
  let highestIndex: number = 0;
  if (addressesArray && Array.isArray(addressesArray)) {
    addressesArray.forEach(el => {
      const hdPath: number[] = hdPathToArray(el['path'])
      if (hdPath[3] === 0) {
        if (hdPath[4] > highestIndex) {
          highestIndex = hdPath[4]
        }
      }
    })
  }
  return [getAddress(xpub, chain, network, highestIndex + 1).toBytes()]
}

function paginateArray(array: HexBlob[], paginate?: Paginate): HexBlob[] {
  let page = 0;
  let limit = array.length;
  if (paginate) {
    page = paginate.page;
    limit = paginate.limit;
  }
  const start = page * limit;
  const end = start + limit;
  return array.slice(start, end);
}

export async function focusOrCreatePopup(url: string, width: number, height: number): Promise<chrome.tabs.Tab> {
  const windows: chrome.windows.Window[] = await chrome.windows.getAll({ populate: true });
  let existingWindow = null;
  let tabb: chrome.tabs.Tab;
  // Iterate through each window and its tabs to find the URL
  for (const window of windows) {
    if (window.type === 'popup') {
      for (const tab of window.tabs) {
        if (tab.url === url) {
          existingWindow = window;
          tabb = tab;
          break;
        }
      }
      if (existingWindow) break;
    }
  }

  if (existingWindow) {
    // Focus on the existing window
    await chrome.windows.update(existingWindow.id, { focused: true });
    return tabb;
  } else {
    // Create a new window with the specified URL
    const window: chrome.windows.Window = await chrome.windows.create({
      url: url,
      type: 'popup',
      focused: true,
      ...POPUP_WINDOW,
      width: width,
      height: height,
    });
    return window.tabs[0];
  }
}

export async function submitTx(tx: string, chain: string, network: string): Promise<Response>  {
  const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain);
  const networkEnum: string = Object.keys(Network).find(key => Network[key] === network);
  return await fetch(`${baseUrl}/api/transactions/submit-tx?chain=${chainEnum}&network=${networkEnum}&provider=KOIOS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tx
  })
}

export const urlScan = async url => {
  const result = await fetch(`${baseUrl}/api/url/scan?url=${url}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (result) {
    console.log('result', result);
  }
  return result;
};

export function getPublicKey(xpub: string): Bip32PublicKey {
  const { words } = bech32.decode(xpub, 120) ?? bech32m.decode(xpub, 120);
  const byteArray = Uint8Array.from(bech32.fromWords(words));
  return Bip32PublicKey.fromBytes(byteArray);
}

export function getStakeKey(xpub: string, index: number): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.CHIMERIC_ACCOUNT, index])
    .toRawKey()
}

export function getDrepKey(xpub: string, index): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.DREP, index])
    .toRawKey()
}

export function hdPathToArray(path: string): number[] {
  // Remove the 'm/' part of the path and split by '/'
  const parts = path.replace('m/', '').split('/');

  // Convert each part to an integer, handling hardened indices
  return parts.map(part => {
    if (part.endsWith("'")) {
      // If the part ends with an apostrophe, it's a hardened index
      return parseInt(part.slice(0, -1), 10) + 0x80000000; // Add the hardened flag
    } else {
      // Otherwise, it's a normal index
      return parseInt(part, 10);
    }
  });
}

export function assetsToValue(assets: AssetType[]): Serialization.Value {
  const coin: Cardano.Lovelace = BigInt(assets.find((asset) => asset.unit === 'lovelace').quantity)
  const multiasset: Cardano.TokenMap = new Map<Cardano.AssetId, bigint>()
  assets // TODO use MAP
    .filter(asset => asset.unit !== 'lovelace')
    .forEach(asset => {
      const assetId: Cardano.AssetId = Cardano.AssetId(asset.unit)
      let quantity: bigint = multiasset.get(assetId)
      if (!quantity) {
        quantity = BigInt(asset.quantity)
      } else {
        quantity += BigInt(asset.quantity)
      }
      multiasset.set(assetId, quantity);
    })
  return new Serialization.Value(coin, multiasset)
}

export function toUTxO(utxo: UTxO): Serialization.TransactionUnspentOutput {
  const tokenMap: Cardano.TokenMap = utxo.asset_list.reduce((map: Cardano.TokenMap, asset: any) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current: bigint = map.get(assetId) ?? BigInt(0);
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());

  return Serialization.TransactionUnspentOutput.fromCore([
    {
      txId: Cardano.TransactionId.fromHexBlob(HexBlob(utxo.tx_hash)),
      index: utxo.tx_index
    },
    {
      address: Cardano.PaymentAddress(utxo.payment_addr.bech32),
      value: {
        coins: BigInt(utxo.value),
        assets: tokenMap,
      },
      datumHash: utxo.datum_hash ? Hash32ByteBase16.fromHexBlob(HexBlob(utxo.datum_hash)) : null,
      datum: utxo.inline_datum ? Serialization.PlutusData.fromCbor(HexBlob(utxo.inline_datum)).toCore() : null,
      scriptReference: utxo.reference_script ? Serialization.Script.fromCbor(HexBlob(utxo.reference_script)).toCore() : null
    }
  ]);
}

/**
 * Detect a type of hex encoded addr and convert to PaymentAddress or RewardAddress.
 *
 * @param addr when hex encoded, it can be a PaymentAddress, RewardAddress or DRepKeyHash
 * @returns PaymentAddress | RewardAddress DRepKeyHash is converted to a type 6 address
 */
export function addrToSignWith(addr: Cardano.PaymentAddress | Cardano.RewardAccount | string): Cardano.PaymentAddress | Cardano.RewardAccount {
  try {
    return Cardano.isRewardAccount(addr) ? Cardano.RewardAccount(addr) : Cardano.PaymentAddress(addr);
  } catch {
    // Try to parse as drep key hash
    const drepKeyHash = Ed25519KeyHashHex(addr);
    const drepId = Cardano.DRepID.cip129FromCredential({
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(drepKeyHash),
      type: Cardano.CredentialType.KeyHash
    });
    const drepAddr: Cardano.Address = Cardano.DRepID.toAddress(drepId)?.toAddress();
    if (!drepAddr) {
      throw DataSignError.AddressNotPK;
    }
    return drepAddr.toBech32();
  }
}

export const getStorage = (key) =>
  new Promise<any>((res, rej) =>
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) rej(undefined);
      res(key ? result[key] : result);
    }),
  );

export const getNetwork = async (): Promise<any> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet)
  return loggedWallet['network'].toLowerCase();
};

