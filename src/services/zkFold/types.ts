import { Cardano } from '@cardano-sdk/core';

/**
 * Wrapper for various integer types used in communication with the Backend, Prover, and CSL.
 * Provides a JSON representation unavailable for bignum.
 */
export class BigIntWrap {
  private int!: bigint

  constructor(num: string | number | bigint) {
    if (typeof num == "string") {
      this.int = BigInt(num)
    } else if (typeof num == "number") {
      this.int = BigInt(num)
    } else {
      this.int = BigInt(num)
    }
  }

  add(other: BigIntWrap): BigIntWrap {
    return new BigIntWrap(this.int + other.int)
  }

  increase(other: BigIntWrap): void {
    this.int += other.int
  }

  toString(): string {
    return this.int.toString()
  }

  toNumber(): number {
    return Number(this.int)
  }

  toBigInt(): bigint {
    return this.int
  }

  toJSON(): bigint {
    return this.int
  }
}

/**
 *  ProofBytes used by Plonkup.
 *  This object will be sent to the backend as a proof that user possesses a valid JSON Web Token
 *  and used in the script redeemer.
 */
export interface ProofBytes {
  "a_xi_int": BigIntWrap
  "b_xi_int": BigIntWrap
  "c_xi_int": BigIntWrap
  "cmA_bytes": string
  "cmB_bytes": string
  "cmC_bytes": string
  "cmF_bytes": string
  "cmH1_bytes": string
  "cmH2_bytes": string
  "cmQhigh_bytes": string
  "cmQlow_bytes": string
  "cmQmid_bytes": string
  "cmZ1_bytes": string
  "cmZ2_bytes": string
  "f_xi_int": BigIntWrap
  "h1_xi'_int": BigIntWrap
  "h2_xi_int": BigIntWrap
  "l1_xi": BigIntWrap
  "l_xi": BigIntWrap[]
  "proof1_bytes": string
  "proof2_bytes": string
  "s1_xi_int": BigIntWrap
  "s2_xi_int": BigIntWrap
  "t_xi'_int": BigIntWrap
  "t_xi_int": BigIntWrap
  "z1_xi'_int": BigIntWrap
  "z2_xi'_int": BigIntWrap
}

/**
 *  RSA public key provided by the prover
 *
 *  @property {BigIntWrap}      public_e    - Public exponent
 *  @property {BigIntWrap}      public_n    - Public modulus
 *  @property {BigIntWrap}      public_size - Key size in bits
 */
export interface PublicKey {
  public_e: BigIntWrap
  public_n: BigIntWrap
  public_size: BigIntWrap
}

/**
 *  RSA public key provided by the prover with its unique identifier
 *
 *  @property {string}         pkbId        - Public key identifier
 *  @property {PublicKey}      pkbPublic    - Public key itself
 */
export interface ProverPublicKey {
  pkbId: string
  pkbPublic: PublicKey
}

/**
 *  ZK Proof input
 *
 *  @property {BigIntWrap}      piPubE         - Google's RSA public exponent
 *  @property {BigIntWrap}      piPubN         - Google's RSA public modulus
 *  @property {BigIntWrap}      piSignature    - Signature attached to the Google OAuth JSON Web Token
 *  @property {BigIntWrap}      piTokenName    - The name of the token minted in the wallet initialisation transaction
 */
export interface ProofInput {
  piPubE: BigIntWrap
  piPubN: BigIntWrap
  piSignature: BigIntWrap
  piTokenName: BigIntWrap
}

/**
 * Smart Wallet Backend settings
 */
export interface Settings {
  network: string
  version: string
}


/**
 *  OAuth client credentials
 *
 *  @property {string}      client_id         - OAuth client id
 *  @property {string}      client_secret     - OAuth client secret
 */
export interface ClientCredentials {
  client_id: string
  client_secret: string
}

/**
 *  This object is sent by the backend upon successful initialisation of a Gmail-based wallet.
 *
 *  @property {Cardano.Address} address         - The new wallet's address
 *  @property {string}      transaction     - Transaction to be signed and submitted to initialise the wallet
 *  @property {number}      transaction_fee - The expected fee of the wallet initialisation transaction
 *  @property {string}      transaction_id  - The ID of the wallet initialisation transaction
 */
export interface CreateWalletResponse {
  address: Cardano.Address
  transaction: string
  transaction_fee: number
  transaction_id: string
}

/**
 *  This object is sent by the backend upon a successful request to the /send_funds endpoint
 *
 *  @property {string}      transaction     - Transaction to be signed and submitted
 *  @property {number}      transaction_fee - The expected fee of the transaction
 *  @property {string}      transaction_id  - The ID of the transaction
 */
export interface SendFundsResponse {
  transaction: string
  transaction_fee: number
  transaction_id: string
}

/**
 *  Transaction ID and email delivery errors, if any
 *
 * @property {string}      transaction_id         - Transaction ID
 * @property {Array}       notifier_errors        - Recipients who were not notified
 */
export interface SubmitTxResult {
  transaction_id: string
  notifier_errors: FailedNotification[]
}

/**
 * Email address to which notification couldn't be delivered and the reason.
 *
 * @property {string} email - Email address
 * @property {string} error - The reason why notification failed
 */
export interface FailedNotification {
  email: string
  error: string
}


/**
 * Details of a token from Cardano Token Registry
 *
 * @property {string} asset - The asset name <minting_policy_id>.<asset_name>
 * @property {string} ticker - The ticker of a token (e.g. SNEK)
 * @property {string} token_name - The token name (e.g. Snek)
 * @property {number} decimal_adjustment - The numeric value that specifies the number of decimal places that the token can have
 * @property {string} logo - The token logo as a base64 string
 */
export interface PrettyToken {
  asset: string
  amount: number
  ticker?: string
  description: string
  token_name: string
  decimal_adjustment?: number
  logo?: string
}

/**
 * Balance of a wallet
 *
 * @property {number} lovelace - The number of lovelace held
 * @property {Array}  tokens - The array of tokens held
 * @property {number} usd - the approximate value of the assets in USD
 */
export interface BalanceResponse {
  lovelace: number
  tokens: PrettyToken[]
  usd: number
}

/**
 * Transaction from transaction history
 *
 * @property {string} transaction_id - Transaction id
 * @property {{ [asset: string]: number }}  value_diff - Dictionary with sent (negative value) and received (positive value) assets
 * @property {string} timestamp - Transaction date
 * @property {Cardano.Address[]} from_addrs - Addresses in the transaction inputs
 * @property {Cardano.Address[]} to_addrs - Addresses in the transaction outputs
 */
export interface Transaction {
  transaction_id: string
  value_diff: { [asset: string]: number }
  timestamp: string
  from_addrs: Cardano.Address[]
  to_addrs: Cardano.Address[]
}

/**
 *  Value object representing assets (lovelace and tokens).
 *  The keys are asset identifiers (policy_id + '.' + asset_name in hex) or 'lovelace' for ADA.
 *  The values are BigIntWrap representing the quantity of each asset.
 */
export interface Value {
  [key: string]: BigIntWrap
}

/**
 * Optional datum (inline or just hash) to be included.
 *
 * @property {any} datum - Datum data
 * @property {boolean} is_inline - true for inline datum, false for just datum hash
 */
export interface TxDatum {
  datum: any
  is_inline: boolean
}

/**
 * Transaction output as expected by the backend.
 *
 * @property {string} address
 * @property {TxDatum} datum  - Optional datum (inline or just hash) to be included
 * @property {Value} value
 *
 * @example
 *
 * { "address": "addr_test1qrsuhwqdhz0zjgnf46unas27h93amfghddnff8lpc2n28rgmjv8f77ka0zshfgssqr5cnl64zdnde5f8q2xt923e7ctqu49mg5",
 *    "datum": {
 *      "datum": "some_datum_data",
 *      "is_inline": true
 *    },
 *    "value": {
 *      "ff80aaaf03a273b8f5c558168dc0e2377eea810badbae6eceefc14ef.474f4c44": 101,
 *      "lovelace": 22
 *    }
 * }
 */
export interface Output {
  address: string
  datum?: TxDatum
  value: Value
}

/**
 * Transaction input reference containing transaction id and output index.
 *
 * @property {string} transaction_id
 * @property {number} output_index
 *
 * Will be serialised to JSON as `${transaction_id}#${output_index}`. For example,
 * "4293386fef391299c9886dc0ef3e8676cbdbc2c9f2773507f1f838e00043a189#1"
 */
export interface Reference {
  transaction_id: string
  output_index: number
}

/**
 * UTxO object containing transaction where it was created, address and assets.
 *
 * @param {Reference}   ref          - Transaction output reference
 * @param {Cardano.Address} address      - UTxO address
 * @param {Value}       value        - UTxO assets
 *
 * @example
 *
 * {
 *      "address": "addr_test1qrsuhwqdhz0zjgnf46unas27h93amfghddnff8lpc2n28rgmjv8f77ka0zshfgssqr5cnl64zdnde5f8q2xt923e7ctqu49mg5",
 *      "ref": {
 *          "transaction_id": "4293386fef391299c9886dc0ef3e8676cbdbc2c9f2773507f1f838e00043a189",
 *          "output_index": 1
 *      }
 *      "value": {
 *          "ff80aaaf03a273b8f5c558168dc0e2377eea810badbae6eceefc14ef.474f4c44": 101,
 *          "lovelace": 22
 *      }
 *  }
 */
export interface UTxO {
  ref: Reference
  address: Cardano.Address
  value: Value
}
