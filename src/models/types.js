const HARD_DERIVATION_START = 2147483648;

const Theme = {
    GERO: "gero"
}

const WalletTypePurpose = {
    BIP44: 2147483692, // HARD_DERIVATION_START + 44;
    CIP1852: 2147485500 // HARD_DERIVATION_START + 1852;
}

const CoinTypes = {
    CARDANO: 2147485463, // HARD_DERIVATION_START + 1815;
    ERGO: 2147484077 // HARD_DERIVATION_START + 429;
}

const Blockchain = {
    CARDANO: "Cardano"
}

const Network = {
    MAINNET: "Mainnet",
    PREPROD: "Preprod"
}

export {
    HARD_DERIVATION_START,
    Theme,
    WalletTypePurpose,
    CoinTypes,
    Blockchain,
    Network
}