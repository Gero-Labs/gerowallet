export const ERROR = {
    accessDenied: 'Access denied',
    wrongPassword: 'Wrong password',
    txTooBig: 'Transaction too big',
    txNotPossible: 'Transaction not possible',
    storeNotEmpty: 'Storage key is already set',
    onlyOneAccount: 'Only one account exist in the wallet.js',
    fullMempool: 'fullMempool',
    submit: 'submit',
};

// Errors dApp Connector
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
        info: 'The request was refused due to lack of access - e.g. wallet.js disconnects.',
    },
    AccountChange: {
        code: -4,
        info: 'The account has changed. The dApp should call `wallet.js.enable()` to reestablish connection to the new account. The wallet.js should not ask for confirmation as the user was the one who initiated the account change in the first place.',
    },
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
        info: 'If a wallet.js enforces data format requirements, this error signifies that the data did not conform to valid formats.',
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
        info: 'User has accepted the transaction sign, but the wallet.js was unable to sign the transaction (e.g. not having some of the private keys).',
    },
    UserDeclined: { code: 2, info: 'User declined to sign the transaction.' },
};
