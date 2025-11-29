import axios, { AxiosInstance } from 'axios';
import { deserialize, serialize } from './utils/json.utils';
import { ProofBytes, ProofInput, BigIntWrap } from '@/services/zkFold/types';

/**
 * A wrapper for interaction with the prover
 * @class
 */
export class Prover {
  private axiosInstance: AxiosInstance;

  /**
   * Creates a new Prover object.
   */
  constructor() {
    this.axiosInstance = axios.create({
      baseURL: import.meta.env['VITE_BACKEND_URL'],
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private headers(additional: Record<string, string> = {}) {
    if (Object.keys(additional).length === 0) {
      return {}
    }
    const headers: Record<string, any> = {
      headers: additional
    }
    return headers
  }

  /**
   * Submit a proof request to the Prover via backend. It will return a Request ID which can be used to retrieve proof status
   * @async
   * @param {ProofInput} proofInput for the expMod circuit: exponent, modulus, signature and token name
   * @returns {string} proof request ID
   */
  public async requestProof(proofInput: ProofInput): Promise<string> {
    console.log('🔐 Requesting proof via backend...')

    // Serialize proofInput to handle BigInt values
    const serializedProofInput = serialize(proofInput)

    const { data } = await this.axiosInstance.post(`/api/zkfold/prove`, {
      proof_input: serializedProofInput
    }, this.headers({ 'Content-Type': 'application/json' }))

    console.log('✅ Proof request submitted, ID:', data.proofId)

    return data.proofId
  }

  /**
   * Retrieve the status of a Proof Request
   * @async
   * @param {string} proofId request ID
   * @returns {ProofBytes | string} ProofBytes if the proof has finished or 'Pending' otherwise
   */
  public async proofStatus(proofId: string): Promise<ProofBytes | null> {
    const { data } = await axios.post(`https://wallet-prover.zkfold.io/v0/proof-status`, proofId,
      // to prevent Axios from parsing the result and messing with numbers
      { ...this.headers({ "Content-Type": "application/json" }), ...{ responseType: 'text' } }
    )
    return this.parseProofStatus(data)
  }

  /**
   * Get a Proof from the Prover. Unlike requestProof(), this method waits for the proof completion
   * @async
   * @param {ProofInput} proofInput for the expMod circuit: exponent, modulus, signature and token name
   * @returns {ProofBytes} ZK proof bytes for the expMod circuit
   */
  public async prove(proofInput: ProofInput): Promise<ProofBytes> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const proofId = await this.requestProof(proofInput)

    while (true) {
      try {
        const response = await this.proofStatus(proofId)

        console.log(`Status: ${response}`)

        if (typeof response === 'object' && response !== null) {
          return response
        }
      } catch (error) {
        console.error('Error checking status:', error)
      }

      await delay(30_000)
    }

  }

  private parseProofStatus(json: string): ProofBytes | null {
    const unsafe = deserialize(json)
    if (unsafe.tag == "Completed") {
      return this.parseProofBytes(unsafe.contents.bytes)
    }
    return unsafe.tag
  }

  private parseProofBytes(json: string): ProofBytes | null {
    console.log(json)
    let unsafe
    if (typeof json === 'string') {
      unsafe = deserialize(json)
    } else if (typeof json === "object") {
      unsafe = json
    } else {
      return null
    }

    const l_xi = []

    for (let i = 0; i < unsafe.l_xi.length; ++i) {
      l_xi.push(new BigIntWrap(unsafe.l_xi[i]))
    }

    return {
      "a_xi_int": new BigIntWrap(unsafe.a_xi_int),
      "b_xi_int": new BigIntWrap(unsafe.b_xi_int),
      "c_xi_int": new BigIntWrap(unsafe.c_xi_int),
      "cmA_bytes": unsafe.cmA_bytes,
      "cmB_bytes": unsafe.cmB_bytes,
      "cmC_bytes": unsafe.cmC_bytes,
      "cmF_bytes": unsafe.cmF_bytes,
      "cmH1_bytes": unsafe.cmH1_bytes,
      "cmH2_bytes": unsafe.cmH2_bytes,
      "cmQhigh_bytes": unsafe.cmQhigh_bytes,
      "cmQlow_bytes": unsafe.cmQlow_bytes,
      "cmQmid_bytes": unsafe.cmQmid_bytes,
      "cmZ1_bytes": unsafe.cmZ1_bytes,
      "cmZ2_bytes": unsafe.cmZ2_bytes,
      "f_xi_int": new BigIntWrap(unsafe.f_xi_int),
      "h1_xi'_int": new BigIntWrap(unsafe["h1_xi'_int"]),
      "h2_xi_int": new BigIntWrap(unsafe.h2_xi_int),
      "l1_xi": new BigIntWrap(unsafe.l1_xi),
      "l_xi": l_xi,
      "proof1_bytes": unsafe.proof1_bytes,
      "proof2_bytes": unsafe.proof2_bytes,
      "s1_xi_int": new BigIntWrap(unsafe.s1_xi_int),
      "s2_xi_int": new BigIntWrap(unsafe.s2_xi_int),
      "t_xi'_int": new BigIntWrap(unsafe["t_xi'_int"]),
      "t_xi_int": new BigIntWrap(unsafe.t_xi_int),
      "z1_xi'_int": new BigIntWrap(unsafe["z1_xi'_int"]),
      "z2_xi'_int": new BigIntWrap(unsafe["z2_xi'_int"])
    }
  }

}
