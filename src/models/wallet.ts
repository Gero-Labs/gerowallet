import Dexie from 'dexie';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import {
  Address,
  Certificate,
  CertificateKind,
  decrypt_with_password,
  encrypt_with_password,
  FixedTransaction,
  RewardAddress,
  StakeDeregistration,
  Transaction,
  TransactionBody,
  TransactionInput,
  TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { Api } from '@/api/api';
import networks from '@/utils/networks';
import {
  ChainDerivations,
  CoinTypes,
  ERROR,
  purpose,
  WalletType,
  WalletTypePurpose,
} from '@/models/types';
import db from '@/db';
import { APIError, DataSignError, STORAGE, TxSendError, TxSignError } from '@/chrome/config';
import { HARDENED, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import ledger from '@/shared/utils/ledger';
import {
  addVkeys, buildAndSignData, createCoseKey,
  createCOSEKeyHex,
  createSignDataBuilder, getOwnedCred, hdPathToArray,
  toHexArray,
} from '@/shared/utils/converter';
import { parseHttpError } from '@/shared/utils/parser';
import { Cardano, Serialization, util } from '@cardano-sdk/core';
import {
  addrToSignWith,
  getAddress,
  getCip129DrepId,
  getDrepKey,
  getPublicKey,
  getRewardAddress,
  getStakeKey, toPaymentCredential,
} from '@/chrome/serialization';
import { Ed25519PublicKey, Bip32PrivateKey, Ed25519PrivateKey } from '@cardano-sdk/crypto';
import trezor from '@/shared/utils/trezor';
import { walletDBSchema, walletDBVersion } from '@/db/schema';
import verifyDataSignature from '@cardano-foundation/cardano-verify-datasignature';
import { COSESign1Builder } from '@emurgo/cardano-message-signing-browser';
import { convertToTxSchema } from '@/chrome/helper';

export class Wallet {
  db: Dexie;
  api: Api;// Lock for the sync function

  id: any;
  name: any;
  icon: any;
  type: any;
  theme: any;
  order: any;
  chain: any;
  network: any;
  publicKey: string;

  encryptedPrivateKey: any;
  passwordLastUpdate: Date;
  userId?: string;
  encryptedMnemonic?: string;
  zkBaseAddress?: Cardano.Address;

  constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, userId?: string, encryptedMnemonic?: string) {
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.type = type;
    this.theme = theme;
    this.order = order;
    this.encryptedPrivateKey = encryptedPrivateKey;
    this.publicKey = publicKey;
    this.passwordLastUpdate = passwordLastUpdate;
    this.chain = chain;
    this.network = network;
    this.userId = userId
    this.encryptedMnemonic = encryptedMnemonic
  }

  static class(wallet, provider) {
    const wal: Wallet = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
      wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network, wallet.userId, wallet.encryptedMnemonic);
    wal.api = new Api(wallet, provider);
    wal.db = new Dexie('wallet-' + wallet.id);
    wal.db.version(walletDBVersion).stores(walletDBSchema);
    return wal;
  }

  static resolvePrivateKey(mnemonic: string): Bip32PrivateKey {
    const bip39entropy = bip39.mnemonicToEntropy(mnemonic);
    return Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39entropy, 'hex'), '');
  }

  static encryptPrivateKey(rootKey: Bip32PrivateKey, password): string {
    const privateKey = this.encryptWithPassword(password, rootKey.bytes());
    return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString();
  }

  static encryptWithPassword(password, rootKeyBytes): string {
    const passwordHex = Buffer.from(password).toString('hex');
    const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
    const salt = cryptoRandomString({ length: 2 * 32 });
    const nonce = cryptoRandomString({ length: 2 * 12 });
    return encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
  }

  verifySpendingPassword(password: string) {
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      return true;
    } catch (e) {
      return false;
    }
  }

  requestAccountKey(password: string, accountIndex: number): {
    accountKey: Bip32PrivateKey,
    paymentKey: Ed25519PrivateKey,
    stakeKey: Ed25519PrivateKey,
    drepKey: Ed25519PrivateKey
  } {
    let accountKey: Bip32PrivateKey;
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const buffer: Buffer = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      accountKey = Bip32PrivateKey.fromBytes(buffer)
        .derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]);
    } catch (e) {
      throw ERROR.wrongPassword;
    }

    return {
      accountKey,
      paymentKey: accountKey.derive([ChainDerivations.EXTERNAL, 0]).toRawKey(),
      stakeKey: accountKey.derive([ChainDerivations.CHIMERIC_ACCOUNT, 0]).toRawKey(),
      drepKey: accountKey.derive([ChainDerivations.DREP, 0]).toRawKey()
    };
  }

  decryptWithPassword(password: string, privateKey): Buffer {
    const passwordHex = Buffer.from(password).toString('hex');
    let decryptedHex;
    try {
      decryptedHex = decrypt_with_password(passwordHex, privateKey);
    } catch (err) {
      throw new Error('Wrong Passphrase');
    }
    return Buffer.from(decryptedHex, 'hex');
  }

  networkId(): number {
    return networks.resolveNetworkId(this.chain, this.network);
  }

  pubKey(index: number): Ed25519PublicKey {
    return getPublicKey(this.publicKey)
      .derive([ChainDerivations.EXTERNAL, index])
      .toRawKey();
  }

  pubKeyInternal(index: number): Ed25519PublicKey {
    return getPublicKey(this.publicKey)
      .derive([ChainDerivations.INTERNAL, index])
      .toRawKey();
  }

  stakeKey(): Ed25519PublicKey {
    return getStakeKey(this.publicKey, 0)
  }

  drepKey(): Ed25519PublicKey {
    return getDrepKey(this.publicKey, 0)
  }

  baseAddress(): Cardano.Address {
    let address: Cardano.Address;
    if (this.type === WalletType.Google) {
      address = this.zkBaseAddress;
    } else {
      address = this.deriveAddressFromPath(0)
    }
    return address;
    // return BaseAddress.from_address(Address.from_bech32("addr1q8gzvfe9dxc2csqcra6u78a9t2qyg5u2k3zkllsynu975yt4raqscm7t80hqu0lq3vxtphzz7fx2xt5vm0he5fmf0nzq2et2pa"))
  }

  stakeAddress(): Cardano.Address {
    return getRewardAddress(this.publicKey, this.chain, this.network)
    // return RewardAddress.from_address(Address.from_bech32("stake1u9637sgvdl9nhmsw8lsgkr9sm3p0yn9r96xdhmu6ya5he3q847rpv"))
  }

  isEnterpriseAddress(): boolean {
    const baseAddress = this.baseAddress();
    return baseAddress.getType() === Cardano.AddressType.EnterpriseScript;
  }

  drepId(): Cardano.DRepID {
    return getCip129DrepId(this.publicKey);
  }

  async signData(address: Cardano.PaymentAddress | Cardano.RewardAccount | string, payload: string, password: string, accountIndex: number, isUsb: boolean) {
    let signatureHex: string, keyHex: string;
    const addr: Cardano.PaymentAddress | Cardano.RewardAccount = addrToSignWith(address);

    if (this.type === WalletType.Ledger) {
      const response: SignedMessageData = await ledger.signData(
        addr, payload, networks.resolveNetwork(this.chain, this.network), accountIndex, isUsb,
      );
      const builder = createSignDataBuilder(toHexArray(response.addressFieldHex), payload);
      signatureHex = buildAndSignData(builder, toHexArray(response.signatureHex), undefined);
      keyHex = createCOSEKeyHex(toHexArray(response.signingPublicKeyHex));
    } else {
      console.log('Signing with Software Wallet...');
      const addressBytes = toHexArray(Cardano.Address.fromBech32(addr).toBytes())
      const credential: Cardano.Credential = toPaymentCredential(Cardano.Address.fromBech32(addr));
      const keyHash: string = credential.hash;
      let accountKey: Ed25519PrivateKey
      const { paymentKey, stakeKey, drepKey } = this.requestAccountKey(password, accountIndex);
      if (keyHash === this.pubKey(0).hash().hex()) {
        accountKey = paymentKey;
      } else if (keyHash === this.stakeKey().hash().hex()) {
        accountKey = stakeKey;
      } else if (keyHash === this.drepKey().hash().hex()) {
        accountKey = drepKey;
      } else {
        throw DataSignError.ProofGeneration;
      }
      const builder: COSESign1Builder = createSignDataBuilder(addressBytes, payload);
      const toSign = builder.make_data_to_sign().to_bytes();
      signatureHex = buildAndSignData(builder, toSign, accountKey);
      const coseKey = createCoseKey(addressBytes, accountKey.toPublic().hex());
      keyHex = util.bytesToHex(coseKey.to_bytes())
      console.log(verifyDataSignature(signatureHex, keyHex, Buffer.from(payload, "hex").toString("utf8"), addr));
    }

    return { signature: signatureHex, key: keyHex };
  }

  // async signTx(unsignedTx: string, partialSign: boolean = false, password: string, keyIndex = 0, utxos, addresses: string[], isUsb?: boolean) {
  //   try {
  //     await Crypto.ready()
  //     const rawTx = deserializeTx(unsignedTx);
  //     const txBody: TransactionBody = rawTx.body();
  //     const credList: Set<any> = new Set()
  //     for (let i = 0; i < txBody.inputs().values().length ; i++) {
  //       const input: TransactionInput = txBody.inputs().values()[i];
  //       const inputTxHash = input.transactionId();
  //       const inputTxIndex = input.index();
  //       const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);
  //
  //       if (utxo) {
  //         const address: string = addresses[utxo.payment_addr.bech32]
  //         credList.add(address)
  //       }
  //     }
  //
  //     // if (this.type === WalletType.Ledger) { // Ledger Signing Logic
  //     //   const wit: string = await ledger.txToLedger(rawTx, this, credList, 0, addresses, utxos, isUsb);
  //     //   return { witnesses: wit };
  //     // } else if (this.type === WalletType.Trezor) { // Trezor Signing Logic
  //     //   console.log('Signing with Trezor...');
  //     //   const wit: TransactionWitnessSet = <TransactionWitnessSet>(
  //     //     await trezor.txToTrezor(txBody, this.baseAddress().toBech32(), 0, true, utxos)
  //     //   );
  //     //   if (!wit) {
  //     //     throw new Error('Trezor did not return a valid witness set.');
  //     //   }
  //     //   const witnessHex = Buffer.from(wit.to_bytes()).toString('hex');
  //     //   return { witnesses: witnessHex };
  //     // } else { // Software Wallet Signing
  //
  //       if (
  //         !partialSign &&
  //         rawTx.witnessSet().vkeys() !== undefined &&
  //         rawTx.witnessSet().vkeys()!.size() !== 0
  //       )
  //         throw new Error(
  //           "Signatures already exist in the transaction in a non partial sign call",
  //         );
  //
  //       const txHash = deserializeTxHash(resolveTxHash(unsignedTx));
  //
  //       console.log('Signing with Software Wallet...');
  //       const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
  //       const decodedHash = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
  //       password = null;
  //       if (!decodedHash && partialSign === false) {
  //         throw TxSignError.ProofGeneration;
  //       }
  //       const prvPaymentKey = resolvePrivatePaymentKey(decodedHash, keyIndex);
  //
  //       const vkeyWitness = new VkeyWitness(
  //         prvPaymentKey.toPublic().hex(),
  //         prvPaymentKey.sign(HexBlob(txHash)).hex(),
  //       );
  //       return {
  //         witnesses: addWitnessSets(unsignedTx, [vkeyWitness])
  //       };
  //     // }
  //   } catch (error) {
  //     throw new Error(`An error occurred during signTx: ${error}.`);
  //   }
  // }

  async signTx(txCbor: string, partialSign: boolean = false, password: string, accountIndex: number, utxos, addresses: string[], isUsb?: boolean): Promise<{ witnesses: string }> {
    const rawTx: FixedTransaction = FixedTransaction.from_hex(txCbor);
    const witnessSet: TransactionWitnessSet = rawTx.witness_set();
    const txBody: TransactionBody = rawTx.body();
    const baseAddress: Cardano.Address = this.baseAddress();
    const stakeAddress: RewardAddress = RewardAddress.from_address(Address.from_bech32(this.stakeAddress().toBech32()))
    // const network= networks.resolveNetwork(appWallet.chain, appWallet.network); TODO
    const credList: Set<any> = new Set()
    const accountData = {
      // state: {
      //   networkId: network.networkId
      // },
      account: {
        pub: this.publicKey,
        path: [purpose.hdwallet, 1815, accountIndex]
      },
      keys: {
        payment: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 0),
        stake: [{
          cred: Serialization.Credential.fromCore(Cardano.BaseAddress.fromAddress(baseAddress).getStakeCredential()).value().hash,
          path: `m/${purpose.hdwallet}'/1815'/${accountIndex}'/${ChainDerivations.CHIMERIC_ACCOUNT}/0`
        }],
        change: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 1),
        script: [],
        drep: [],
        cc_cold: [],
        cc_hot: []
      }
    }
    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input: TransactionInput = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);

      if (utxo) {
        const address: string = addresses[utxo.payment_addr.bech32]
        credList.add(address)
      }
    }
    if (txBody.certs()) {
      console.log('certs')
      for (let i = 0 ; i < txBody.certs().len() ; i++) {
        const certificate: Certificate = txBody.certs().get(i);
        let keyHash
        if (certificate.kind() == CertificateKind.StakeRegistration) {
          const stakeRegistration = certificate.as_stake_registration()
          keyHash = stakeRegistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDeregistration) {
          const stakeDeregistration: StakeDeregistration = certificate.as_stake_deregistration()
          keyHash = stakeDeregistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDelegation) {
          const stakeDelegation = certificate.as_stake_delegation()
          keyHash = stakeDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.PoolRegistration) {
        //
        // } else if (certificate.kind() == CertificateKind.PoolRetirement) {
        //
        // } else if (certificate.kind() == CertificateKind.GenesisKeyDelegation) {
        //
        // } else if (certificate.kind() == CertificateKind.MoveInstantaneousRewardsCert) {
        //
        // } else if (certificate.kind() == CertificateKind.CommitteeHotAuth) {
        //
        // } else if (certificate.kind() == CertificateKind.CommitteeColdResign) {
        //
        // } else if (certificate.kind() == CertificateKind.DRepDeregistration) {
        //
        // }
        // else if (certificate.kind() == CertificateKind.DRepRegistration) {
        //
        // }
        // else if (certificate.kind() == CertificateKind.DRepUpdate) {
        //
        // } else if (certificate.kind() == CertificateKind.StakeAndVoteDelegation) {
        //
        // }
        else if (certificate.kind() == CertificateKind.StakeRegistrationAndDelegation) {
          const stakeRegistrationAndDelegation = certificate.as_stake_registration_and_delegation()
          keyHash = stakeRegistrationAndDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.StakeVoteRegistrationAndDelegation) {
        //
        // }
        else if (certificate.kind() == CertificateKind.VoteDelegation) {
          const voteDelegation = certificate.as_vote_delegation()
          keyHash = voteDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.VoteRegistrationAndDelegation) {
        //
        // }
        if (accountData.keys.stake[0].cred === keyHash) {
          credList.add(accountData.keys.stake[0])
        }
      }
    }
    if (txBody.withdrawals()) {
      const bigNum = txBody.withdrawals().get(stakeAddress)
      if (bigNum) {
        credList.add(accountData.keys.stake[0])
      }
    }
    const vKeyHashes = new Set();
    if (witnessSet?.vkeys()) {
      for (let i = 0 ; i < witnessSet.vkeys().len() ; i++) {
        vKeyHashes.add(witnessSet.vkeys().get(i).vkey().public_key().hash().to_hex())
      }
    }
    if (txBody.required_signers()) {
      for (let i = 0 ; i < txBody.required_signers().len(); i++) {
        const requiredKeyHash = txBody.required_signers().get(i)
        const requiredVKeyHash = requiredKeyHash.to_hex()
        if (!vKeyHashes.has(requiredVKeyHash)) {
          credList.add(getOwnedCred([accountData.keys], requiredVKeyHash))
        }
      }
    }
    if (this.type === WalletType.Ledger) { // Ledger Signing Logic
      const wit: string = await ledger.txToLedger(rawTx, this, credList, 0, addresses, utxos, isUsb);
      return { witnesses: wit };
    } else if (this.type === WalletType.Trezor) { // Trezor Signing Logic
      console.log('Signing with Trezor...');
      const wit: TransactionWitnessSet = <TransactionWitnessSet>(
        await trezor.txToTrezor(txBody, this.baseAddress().toBech32(), accountIndex, true, utxos)
      );
      if (!wit) {
        throw new Error('Trezor did not return a valid witness set.');
      }
      const witnessHex = Buffer.from(wit.to_bytes()).toString('hex');
      return { witnesses: witnessHex };
    } else { // Software Wallet Signing
      console.log('Signing with Software Wallet...');
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const decodedHash = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      password = null;
      if (!decodedHash && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }
      const prvRootKeyBech32: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash)
      const txHash = rawTx.transaction_hash();

      addVkeys(txHash, witnessSet, credList, prvRootKeyBech32)
      return {
        witnesses: witnessSet.to_hex()
      };
    }
  }

  async submitTx(tx: Transaction, utxos) {
    const txCbor = tx.to_hex()
    try {
      const txId = await this.api.submitTx(txCbor);
      const tx = convertToTxSchema(txId, txCbor, utxos, this.networkId())
      this.setAccountTransactions([tx])
        .catch(e => console.log(e))
      return txId;
    } catch (error) {
      console.log(error)
      if (error['response'].status === 400) {
        throw new Error(TxSendError.Failure.info.concat('', ' ', JSON.stringify(error['response'].data)));
      } else if (error['response'].status === 500) {
        throw new Error(APIError.InternalError.info);
      } else if (error['response'].status === 429) {
        throw new Error(TxSendError.Refused.info);
      } else if (error['response'].status === 425) {
        throw new Error(ERROR.fullMempool);
      } else {
        throw new Error(APIError.InvalidRequest.info.concat('', ' ', JSON.stringify(error['response'].data)));
      }
    }
  }

  public async getDetailedAssetsInfo(policyId: string, assetName: string) {
    try {
      // const blockchainDB: Dexie = await this.getBlockchainDb();
      // const assetsTable = blockchainDB.table('assets');
      const res = await this.api.getDetailedAssetsInfo(policyId, assetName);
      if (res.status === 200) {
        // assetsTable.bulkPut(res);
        return res.data;
      } else {
        console.log(parseHttpError(res))
      }
    } catch (e) {
      console.log(e);
    }
    return null;
  }

  deriveAddressFromPath(addressIndex: number): Cardano.Address {
    return getAddress(this.publicKey, this.chain, this.network, addressIndex)
  }

  async setAccountTransactions(txs): Promise<any> {
    return this.db.open()
      .then(db => {
        const txsTable = db.table('transactions');
        if (txsTable) {
          txs = txs.map(tx => {
            return { id: tx.tx_hash, transaction: tx };
          });
          txsTable.bulkPut(txs);
        }
      }).catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async getDb(): Promise<Dexie> {
    return this.db.open();
  }

  public async getBlockchainDb(): Promise<Dexie> {
    return db.checkAndCreateBlockchainDatabase(this.chain + '_' + this.network);
  }

  async addConnectedDapp(domain: string) {
    try {
      const db = await this.db.open();
      const dappsTable = db.table('connected_dapps');

      if (!dappsTable) throw new Error('No Connected Dapps Table.');

      // Check if the domain already exists in the table
      const existingDapp = await dappsTable.get({ domain: domain });

      if (existingDapp) {
        console.log(`Domain ${domain} already exists, ignoring.`);
        return;
      }

      // Insert new domain
      const domainObject = { domain, time: new Date().getTime() }
      domainObject['id'] = await dappsTable.put(domainObject)
      console.log(`Domain ${domain} added successfully.`);

      // Update chrome storage if available
      if (chrome?.storage) {
        const res = await chrome.storage.local.get([STORAGE.whitelisted]);
        const whitelisted = res[STORAGE.whitelisted] || [];
        whitelisted.push(domainObject);
        await chrome.storage.local.set({ [STORAGE.whitelisted]: whitelisted });
        console.log(`Updated chrome storage with new domain:`, domainObject);
      }
    } catch (err) {
      console.error(`Failed to add connected dapp: ${err}`);
    }
  }
}
