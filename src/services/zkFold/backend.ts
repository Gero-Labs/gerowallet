import axios from 'axios';

import { serialize } from '@/services/zkFold/utils/json.utils';
import {
  BalanceResponse,
  BigIntWrap,
  ClientCredentials,
  CreateWalletResponse,
  Output,
  ProofBytes,
  Reference,
  SendFundsResponse,
  Settings,
  SubmitTxResult,
  Transaction,
  UTxO,
} from '@/services/zkFold/types';
import { Cardano } from '@cardano-sdk/core';

/**
 * A wrapper for interaction with the backend.
 * @class
 */
export class Backend {
  private readonly url: string
  private readonly secret: string | null

  /**
   * Creates a new Backend object.
   * @param {string} url     - Backend's URL
   * @param {string} secret  - optional Backend's secret (API key)
   */
  constructor(url: string, secret: string | null = null) {
    this.url = url
    this.secret = secret
  }

  private headers(additional: Record<string, string> = {}) {
    if (Object.keys(additional).length === 0 && !this.secret) {
      return {}
    }
    const headers: Record<string, any> = {
      headers: additional
    }
    if (this.secret) {
      headers['headers']['api-key'] = this.secret
    }
    return headers
  }

  /**
   * Get server settings including network and version information.
   * @async
   * @returns {Settings}
   */
  async settings(): Promise<Settings> {
    const { data } = await axios.get(`${this.url}/v0/settings`, this.headers())
    return data
  }

  /**
   * Get Google OAuth credentials
   * @async
   * @returns {ClientCredentials}
   */
  async credentials(): Promise<ClientCredentials> {
    const { data } = await axios.get(`${this.url}/v0/oauth/credentials`, this.headers())
    return data
  }

  /**
   * Activate a Smart Wallet.
   * This will create a minting transaction which should be signed and submitted.
   * @async
   * @param {string} jwt    - Base64url-decoded Google JSON web token without signature
   * @param {string} payment_key_hash  - Token name (the hash of a public key used to initialise the wallet)
   * @param {ProofBytes} proof_bytes   - Zero-knowledge proof that the user possesses a valid JWT
   * @returns {CreateWalletResponse}
   */
  async activateWallet(jwt: string, payment_key_hash: string, proof_bytes: ProofBytes): Promise<CreateWalletResponse> {
    const requestData = {
      'jwt': jwt,
      'payment_key_hash': payment_key_hash,
      'proof_bytes': proof_bytes
    }

    const payload = serialize(requestData)

    const { data } = await axios.post(`${this.url}/v0/wallet/activate`, payload,
      this.headers({ 'Content-Type': 'application/json' })
    )

    return {
      address: Cardano.Address.fromBech32(data.address),
      transaction: data.transaction,
      transaction_fee: data.transaction_fee,
      transaction_id: data.transaction_id
    }
  }

  /**
   * Activate a Smart Wallet and send funds from it.
   * This will create transaction which should be signed and submitted.
   * @async
   * @param {string} jwt    - Base64url-decoded Google JSON web token without signature
   * @param {string} payment_key_hash  - Token name (the hash of a public key used to initialise the wallet)
   * @param {ProofBytes} proof_bytes   - Zero-knowledge proof that the user possesses a valid JWT
   * @param {Output[]} outs            - Transaction outputs (where to send funds)
   * @returns {CreateWalletResponse}
   */
  async activateAndSendFunds(jwt: string, payment_key_hash: string, proof_bytes: ProofBytes, outs: Output[]): Promise<CreateWalletResponse> {
    const requestData = {
      'jwt': jwt,
      'payment_key_hash': payment_key_hash,
      'proof_bytes': proof_bytes,
      'outs': outs,
    }

    const payload = serialize(requestData)

    const { data } = await axios.post(`${this.url}/v0/wallet/activate-and-send-funds`, payload,
      this.headers({ 'Content-Type': 'application/json' })
    )

    return {
      address: Cardano.Address.fromBech32(data.address),
      transaction: data.transaction,
      transaction_fee: data.transaction_fee,
      transaction_id: data.transaction_id
    }
  }

  /**
   * Send funds from an activated Smart Wallet.
   * This will create transaction which should be signed and submitted.
   * @async
   * @param {string} email
   * @param {Output[]} outs            - Transaction outputs (where to send funds)
   * @param {string} payment_key_hash  - Token name (the hash of a public key used to initialise the wallet)
   * @returns {SendFundsResponse}
   */
  async sendFunds(email: string, outs: Output[], payment_key_hash: string): Promise<SendFundsResponse> {
    const requestData = {
      'email': email,
      'outs': outs,
      'payment_key_hash': payment_key_hash,
    }

    const payload = serialize(requestData)

    const { data } = await axios.post(`${this.url}/v0/wallet/send-funds`, payload,
      this.headers({ 'Content-Type': 'application/json' })
    )

    return {
      transaction: data.transaction,
      transaction_fee: data.transaction_fee,
      transaction_id: data.transaction_id
    }
  }

  /**
   * Submit a CBOR-encoded transaction.
   * @async
   * @param {string} transaction
   * @param {string[]} email_recipients
   * @param sender
   * @returns {SubmitTxResult} - Transaction ID and email delivery errors, if any
   */
  async submitTx(transaction: string, email_recipients: string[] = [], sender?: string): Promise<SubmitTxResult> {
    const { data } = await axios.post(`${this.url}/v0/tx/submit`, {
      email_recipients: email_recipients,
      sender: sender,
      transaction: transaction
    }, this.headers())

    return {
      notifier_errors: data.notifier_errors,
      transaction_id: data.transaction_id
    }
  }

  /**
   * Add a witness to the transaction, submit it and notify recipients by email.
   * @async
   * @param {string} unsigned_transaction
   * @param {string} vkey_witness
   * @param {string[]} email_recipients
   * @param sender
   * @returns {SubmitTxResult} - Transaction ID and email delivery errors, if any
   */
  async addVkeyAndSubmitTx(unsigned_transaction: string, vkey_witness: string, email_recipients: string[] = [], sender?: string): Promise<SubmitTxResult> {
    const { data } = await axios.post(`${this.url}/v0/tx/add-vkey-and-submit`, {
      unsigned_transaction: unsigned_transaction,
      vkey_witness: vkey_witness,
      email_recipients: email_recipients,
      sender: sender
    }, this.headers())

    return {
      notifier_errors: data.notifier_errors,
      transaction_id: data.transaction_id
    }
  }

  /**
   * Get all UTxOs held by an address
   * @async
   * @param {Cardano.Address} address
   * @returns {UTxO[]}
   */
  async addressUtxo(address: Cardano.Address): Promise<UTxO[]> {
    const { data } = await axios.post(`${this.url}/v0/address/utxos`, [address.toBech32()], this.headers())

    const result: UTxO[] = []

    for (let i = 0; i < data.length; i++) {
      const ref = data[i].ref
      const parts = ref.split("#")
      const reference: Reference = {
        transaction_id: parts[0],
        output_index: Number(parts[1])
      }

      const values: { [key: string]: BigIntWrap } = {}

      for (const key in data[i].value) {
        values[key] = new BigIntWrap(data[i].value[key])
      }

      const utxo: UTxO = {
        ref: reference,
        address: Cardano.Address.fromBech32(data[i].address),
        value: values
      }
      result.push(utxo)
    }

    return result
  }

  /**
   * Get assets held by an address and their approximate value in USD
   * @async
   * @param {Cardano.Address} address
   * @returns {BalanceResponse}
   */
  async balance(address: Cardano.Address): Promise<BalanceResponse> {
    const { data } = await axios.post(`${this.url}/v0/address/balance`, address.toBech32(), this.headers({ 'Content-Type': 'application/json' }))
    return data
  }

  /**
   * Get transaction history of a email address
   * @async
   * @param {string} email
   * @returns {Transaction[]}
   */
  async txHistory(email: string): Promise<Transaction[]> {
    const { data } = await axios.post(`${this.url}/v0/wallet/txs`, { 'email': email }, this.headers())

    console.log(data)

    // TODO: fetch token tickers from Cardano Token Registry if it isn't done on the back end
    return data.map((tx: any) => {
      tx.from_addrs = tx.from_addrs.map((addr: string) => Cardano.Address.fromBech32(addr))
      tx.to_addrs = tx.to_addrs.map((addr: string) => Cardano.Address.fromBech32(addr))
      return tx
    })
  }

  /**
   * Request proof generation from zkFold prover (via backend proxy)
   * The backend handles encryption and forwards to zkFold prover service
   * @async
   * @param {any} proofInput - Proof input containing exponent, modulus, signature, token name
   * @returns {string} Proof ID for polling status
   */
  async requestProof(proofInput: any): Promise<string> {
    const { data } = await axios.post(`${this.url}/zkfold/prove`, {
      proofInput: proofInput
    }, this.headers())

    return data.proofId
  }

  /**
   * Check proof generation status
   * @async
   * @param {string} proofId - The proof ID from requestProof
   * @returns {string} Raw JSON string (proof status or proof bytes)
   */
  async getProofStatus(proofId: string): Promise<string> {
    const { data } = await axios.get(`${this.url}/zkfold/proof-status/${proofId}`, {
      ...this.headers(),
      responseType: 'text'
    })

    return data
  }

}
