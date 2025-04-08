import Dexie from 'dexie';
import networks from '@/shared/utils/networks';
import { Wallet } from './wallet';
import { StringNullableChain } from 'lodash';
import { ScriptNOfK } from '@emurgo/cardano-serialization-lib-browser';
import db from '@/db';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import {
  Address,
  BaseAddress,
  BigNum,
  Bip32PrivateKey,
  Bip32PublicKey,
  Certificate,
  CertificateKind,
  Credential,
  decrypt_with_password,
  DRep,
  Ed25519KeyHash,
  encrypt_with_password,
  EnterpriseAddress,
  FixedTransaction,
  NativeScript,
  PointerAddress,
  PrivateKey,
  PublicKey,
  RewardAddress,
  ScriptHash,
  Transaction,
  TransactionBody,
  TransactionHash,
  TransactionInput,
  TransactionJSON,
  TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { Api } from '@/api/api';
import {
  Blockchain,
  ChainDerivations,
  CoinTypes,
  ERROR,
  purpose,
  STAKING_KEY_INDEX,
  WalletType,
  WalletTypePurpose,
} from '@/models/types';
import { chunkArray } from 'array-chunk-by-size';
import { extractKeyHash } from '@/chrome/extension';
import { APIError, DataSignError, STORAGE, TxSendError, TxSignError } from '@/chrome/config';
import { HARDENED, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import ledger from '@/shared/utils/ledger';
import trezor from '@/shared/utils/trezor';
import loading from '@/plugins/loading';
import { appWallet, useStore } from '@/store';
import {
  addVkeys,
  createCOSEKeyHex,
  createSignDataBuilder,
  getOwnedCred,
  hdPathToArray,
  paymentCredential,
  safeFreeCSLObject,
  stakeCredential,
  toHexArray,
  toHexString,
} from '@/shared/utils/converter';
import { parseHttpError } from '@/shared/utils/parser';

const blake2b = require('blake2b');

export class MultisigWallet extends Wallet{
  signers: string[] = [];
  currentWallet: Wallet; // loggedInWallet
  scriptJson: string;
  multisig: MultisigWallet;
  primarySigner: string; //current wallet bech32Address
  //encryptionPrivateKey and public key will be same as primarysigner/owner
  

  /*
  // check with dudi's branch using cardano-sdk. branchname is lots
  //ID = multisig-xpub1pmz4lpp5tvgpsa (multi-publicKey(16characters after xpub1))
  // duplicate async createNewWalletDb(walletId: number) in db/index.ts so you can save this multisig by code re-use.
  // future (a)
  //  - need to be able to delete the wallet assigned to yourself.
      - add securitu

  */

  constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, signers, isMultisig) {
    super(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network);
    this.name = name;
    this.signers = signers;
  }
  static classMultisig(wallet, provider) {
    const wal: Wallet = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
      wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network);
    wal.api = new Api(wallet, provider);
    console.log('class');
    wal.db = new Dexie('multisig-' + wallet.publicKey.slice(0,21)); //xpub1lnyv9yu3gjge6stulu3ed0ns6pc2e6253rzx3wnklgflfdnqtnlpgptc4drpx2ry4502jd4wdc7aev3m8pzxdfjp08atjatppqwgtgc7n2tun
    wal.db.open().catch(async err => {
      if (err.name === 'NoSuchDatabaseError') {
        await db.createNewWalletDb(wallet.id);
      }
      console.log(err);
    });
    return wal;
  }
 }

export interface Signer {
  name: string;
  address: string;
  isThisWallet: boolean;
}

export interface IMultisigWallet {
  name: string;
  minSigners: number;
  signers: Signer[];
  createdAt: string;
}

export interface MultisigTransaction {
  id: string;
  walletId: string;
  requiredSignatures: number;
  collectedSignatures: number;
  status: MultisigTransactionStatus;
  createdAt: string;
  expiresAt?: string;
}

export enum MultisigTransactionStatus {
  PENDING = 'PENDING',
  SIGNED = 'SIGNED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  COMPLETED = 'COMPLETED',
} 
