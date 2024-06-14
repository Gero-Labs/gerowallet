export const TARGET = 'gero-wallet';
export const SENDER = { extension: 'extension', webpage: 'webpage' };
export const METHOD = {
  isWhitelisted: 'isWhitelisted',
  enable: 'enable',
  isEnabled: 'isEnabled',
  currentWebpage: 'currentWebpage',
  getNetworkId: 'getNetworkId',
  getBalance: 'getBalance',
  getDelegation: 'getDelegation',
  getUtxos: 'getUtxos',
  getCollateral: 'getCollateral',
  getRewardAddress: 'getRewardAddress',
  getAddress: 'getAddress',
  signData: 'signData',
  signTx: 'signTx',
  submitTx: 'submitTx',
  //internal
  requestData: 'requestData',
  returnData: 'returnData',
};

export const APIError = {
  InvalidRequest: {
    code: -1,
    info: 'Inputs do not conform to this spec or are otherwise invalid.',
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

export const POPUP = {
  main: 'mainPopup',
  internal: 'internalPopup',
};

export const STORAGE = {
  whitelisted: 'whitelisted',
  encryptedKey: 'encryptedKey',
  accounts: 'accounts',
  currentAccount: 'currentAccount',
  network: 'network',
  currency: 'currency',
  migration: 'migration',
  analyticsConsent: 'analytics',
  userId: 'userId',
  acceptedLegalDocsVersion: 'acceptedLegalDocsVersion',
};

export const EVENT = {
  accountChange: 'accountChange',
  networkChange: 'networkChange',
  // TODO
  // connect: 'connect',
  // disconnect: 'disconnect',
  // utxoChange: 'utxoChange',
};
