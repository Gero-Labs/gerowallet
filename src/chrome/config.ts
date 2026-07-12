export const TARGET = 'gerowallet';
export const SENDER = {
  extension: 'extension',
  webpage: 'webpage',
  options: 'options',
};

export const METHOD = {
  isWhitelisted: 'isWhitelisted',
  blacklisted:'blacklisted',
  enable: 'enable',
  isEnabled: 'isEnabled',
  currentWebpage: 'currentWebpage',
  getNetworkId: 'getNetworkId',
  getBalance: 'getBalance',
  getDelegation: 'getDelegation',
  getUtxos: 'getUtxos',
  getCollateral: 'getCollateral',
  getRewardAddresses: 'getRewardAddresses',
  getUsedAddresses: 'getUsedAddresses',
  getUnusedAddresses: 'getUnusedAddresses',
  getAddress: 'getAddress',
  getAddressBech32: 'getAddressBech32',
  signData: 'signData',
  popupLogin: 'popupLogin',
  signTx: 'signTx',
  submitTx: 'submitTx',
  //internal
  requestData: 'requestData',
  returnData: 'returnData',
  // cip 95
  getPubDRepKey: 'getPubDRepKey',
  getRegisteredPubStakeKeys: 'getRegisteredPubStakeKeys',
  getUnregisteredPubStakeKeys: 'getUnregisteredPubStakeKeys',
  // cip 104
  getAccountPub: 'getAccountPub',
  // cip 142
  getNetworkMagic: 'getNetworkMagic'
};

export const APIError = {
  InvalidRequest: {
    code: -1,
    info: 'Inputs do not conform to this spec or are otherwise invalid.',
  },
  AccountNotSet: {
    code: -2,
    info: 'No Account Set.',
  },
  InternalError: {
    code: -2,
    info: 'An error occurred during execution of this API call.',
  },
  Refused: {
    code: -3,
    info: 'The request was refused due to lack of access - e.g. wallet disconnects.',
  },
  AccountChange: {
    code: -4,
    info: 'The account has changed. The dApp should call `wallet.enable()` to reestablish connection to the new account. The wallet should not ask for confirmation as the user was the one who initiated the account change in the first place.',
  },
};

export const NETWORKD_ID_NUMBER = {
  mainnet: 1,
  testnet: 0,
  preview: 0,
  preprod: 0,
};

// Midnight DApp Connector (@midnight-ntwrk/dapp-connector-api v4.0.1). One
// entry per `ConnectedAPI` method, plus `connect` for the `InitialAPI`
// handshake (the spec has no `isEnabled`-style pre-connect status check —
// `getConnectionStatus` on the ALREADY-connected API is the analog, and it's
// whitelist-gated normally since by then the origin is already approved).
// `connect` is the Midnight equivalent of CIP-30's `enable` — the proxy
// controller (messaging.ts) must bypass the isWhitelisted pre-check for it,
// exactly like `enable`, since its OWN handler performs the approval.
export const MIDNIGHT_METHOD = {
  connect: 'midnight_connect',
  getShieldedBalances: 'midnight_getShieldedBalances',
  getUnshieldedBalances: 'midnight_getUnshieldedBalances',
  getDustBalance: 'midnight_getDustBalance',
  getShieldedAddresses: 'midnight_getShieldedAddresses',
  getUnshieldedAddress: 'midnight_getUnshieldedAddress',
  getDustAddress: 'midnight_getDustAddress',
  getTxHistory: 'midnight_getTxHistory',
  getConfiguration: 'midnight_getConfiguration',
  getConnectionStatus: 'midnight_getConnectionStatus',
  submitTransaction: 'midnight_submitTransaction',
  signData: 'midnight_signData',
  hintUsage: 'midnight_hintUsage',
};

// Error codes from `@midnight-ntwrk/dapp-connector-api`'s `ErrorCodes` —
// duplicated as plain strings (not imported) so `content.ts`/`inject.ts`
// (page-context bundle) don't need the npm package's runtime import, only
// its types. Values are verified byte-identical against the installed
// 4.0.1 package's `errors.d.ts`.
export const MidnightErrorCode = {
  InternalError: 'InternalError',
  Rejected: 'Rejected',
  InvalidRequest: 'InvalidRequest',
  PermissionRejected: 'PermissionRejected',
  Disconnected: 'Disconnected',
} as const;

export const BITCOIN_METHOD = {
  enable: 'bitcoin_enable',
  isEnabled: 'bitcoin_isEnabled',
  getAccounts: 'bitcoin_getAccounts',
  getPublicKey: 'bitcoin_getPublicKey',
  getNetwork: 'bitcoin_getNetwork',
  getBalance: 'bitcoin_getBalance',
  getUtxos: 'bitcoin_getUtxos',
  signPsbt: 'bitcoin_signPsbt',
  signPsbts: 'bitcoin_signPsbts',
  signMessage: 'bitcoin_signMessage',
  pushTx: 'bitcoin_pushTx',
  pushPsbt: 'bitcoin_pushPsbt',
};

export const POPUP = {
  main: 'mainPopup',
  signTx: 'sign-tx',
  dappConnect: 'dapp-connect',
  dappSignData: 'dapp-sign',
  bitcoinSignPsbt: 'sign-bitcoin-psbt',
  bitcoinSignMessage: 'sign-bitcoin-message',
  warning:'warning',
  passKeyAuth: 'passkey-auth',
  wcSessionProposal: 'wc-session-proposal',
};

export const POPUP_WINDOW = {
  top: 50,
  left: 100,
};

export const EVENT = {
  accountChange: 'accountChange',
  networkChange: 'networkChange',
  // TODO
  // connect: 'connect',
  // disconnect: 'disconnect',
  // utxoChange: 'utxoChange',
};

export const NETWORK_ID = {
  mainnet: 'mainnet',
  testnet: 'testnet',
  preview: 'preview',
  preprod: 'preprod',
};

export const DataSignError = {
  ProofGeneration: {
    code: 1,
    info: 'Wallet could not sign the data (e.g. does not have the secret key associated with the address).',
  },
  AddressNotPK: {
    code: 2,
    info: 'Address was not a P2PK address or Reward address and thus had no SK associated with it.',
  },
  UserDeclined: { code: 3, info: 'User declined to sign the data.' },
  InvalidFormat: {
    code: 4,
    info: 'If a wallet enforces data format requirements, this error signifies that the data did not conform to valid formats.',
  },
};

export const TxSendError = {
  Refused: {
    code: 1,
    info: 'Wallet refuses to send the tx (could be rate limiting).',
  },
  Failure: { code: 2, info: 'Wallet could not send the tx.' },
};

export const TxSignError = {
  ProofGeneration: {
    code: 1,
    info: 'User has accepted the transaction sign, but the wallet was unable to sign the transaction (e.g. not having some of the private keys).',
  },
  UserDeclined: { code: 2, info: 'User declined to sign the transaction.' },
};
