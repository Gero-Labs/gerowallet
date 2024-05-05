import {HARDENED} from '@cardano-foundation/ledgerjs-hw-app-cardano';

const WalletType = {
    Trezor: 'Trezor',
    Ledger: 'Ledger',
    Normal: 'Normal'
}

const Theme = {
    GERO: "gero"
}
const purpose = {
    hdwallet: 1852,
    minting: 1855,
    multisig: 1854,
    voting: 1694
}

const WalletTypePurpose = {
    BIP44: HARDENED + 44,
    CIP1852: HARDENED + 1852
}

const CoinTypes = {
    CARDANO: HARDENED + 1815, // HARD_DERIVATION_START + 1815;
    ERGO: HARDENED + 429 // HARD_DERIVATION_START + 429;
}

const Blockchain = {
    CARDANO: "Cardano",
    APEX_PRIME: "Apex Fusion Prime",
}

const Network = {
    MAINNET: "Mainnet",
    PREPROD: "Preprod",
    TESTNET: "Testnet",
}

export {
    HARDENED,
    WalletType,
    Theme,
    WalletTypePurpose,
    CoinTypes,
    Blockchain,
    Network
}