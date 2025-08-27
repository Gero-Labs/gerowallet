
import axios from 'axios';
import forge from 'node-forge';
import { ProofBytes, BackendKey, ProofInput } from './Types';
import { serialize, parseBackendKeys, parseProofStatus } from './JSON';


/**
 * A wrapper for interaction with the prover 
 * @class
 */
export class Prover {
    private url: string;

    /**
     * Creates a new Prover object.
     * @param {string} url     - Prover's URL
     */
    constructor(url: string) {
        this.url = url;
    }

    private headers(additional: Record<string, string> = {}) {
        if (Object.keys(additional).length === 0) {
            return {}
        }
        const headers: Record<string, any> = {
            headers: additional
        }
        return headers;
    }

    /**
     * Get all public keys held by the Prover 
     * @async
     * @returns {BackendKey[]}
     */
    async serverKeys(): Promise<BackendKey[]> {
        const { data } = await axios.get(`${this.url}/v0/keys`, this.headers());
        console.log(data);
        return parseBackendKeys(data);
    }


    /**
     * Submit a proof request to the Prover. It will return a Request ID which can be used to retrieve proof status
     * @async
     * @param {ProofInput} inputs for the expMod circuit: exponent, modulus, signature and token name
     * @returns {string} proof request ID
     */
    async requestProof(proofInput: ProofInput): Promise<string> {
        const keys = await this.serverKeys();

        //TODO: choose the freshest one if we end up implementing key rotation
        const key = keys[0];

        const payload = serialize(proofInput);

        // 1. Generate AES-256 key and IV
        const aesKey = forge.random.getBytesSync(32); // 256 bits
        const iv = forge.random.getBytesSync(16);     // 128-bit IV for AES-CBC

        // 2. AES encrypt the plaintext with AES-256-CBC and PKCS#7 padding
        const cipher = forge.cipher.createCipher('AES-CBC', aesKey);
        cipher.start({ iv: iv });
        cipher.update(forge.util.createBuffer(payload));
        cipher.finish();
        const encryptedData = cipher.output.getBytes(); // Encrypted payload

        // 3. Prepend IV to the ciphertext
        const ivPlusCipher = iv + encryptedData;

        const n = new forge.jsbn.BigInteger(key.pkbPublic.public_n.toString(), 10);
        const e = new forge.jsbn.BigInteger(key.pkbPublic.public_e.toString(), 10);
        const publicKey = forge.pki.setRsaPublicKey(n, e);

        // 5. Encrypt AES key using RSA PKCS#1 v1.5
        const encryptedKey = publicKey.encrypt(aesKey, 'RSAES-PKCS1-V1_5');

        const proveRequest = {
            preqKeyId: key.pkbId,
            preqAES: forge.util.bytesToHex(encryptedKey),
            preqPayload: forge.util.bytesToHex(ivPlusCipher)
        };

        const { data } = await axios.post(`${this.url}/v0/prove`, proveRequest, this.headers());

        return data;
    }

    /**
     * Retrieve the status of a Proof Request 
     * @async
     * @param {string} Proof request ID 
     * @returns {ProofBytes | string} ProofBytes if the proof has finished or 'Pending' otherwise
     */
    async proofStatus(proofId: string): Promise<ProofBytes | string> {
        const { data } = await axios.post(`${this.url}/v0/proof-status`, proofId,
            // to prevent Axios from parsing the result and messing with numbers
            { ...this.headers({ "Content-Type": "application/json" }), ...{ responseType: 'text' } }
        );
        return parseProofStatus(data);
    }

    /**
     * Obtain a Proof from the Prover. Unlike requestProof(), this method waits for the proof completion 
     * @async
     * @param {ProofInput} inputs for the expMod circuit: exponent, modulus, signature and token name
     * @returns {ProofBytes} ZK proof bytes for the expMod circuit 
     */
    async prove(proofInput: ProofInput): Promise<ProofBytes> {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const proofId = await this.requestProof(proofInput);

        while (true) {
            try {
                const response = await this.proofStatus(proofId);

                console.log(`Status: ${response}`);

                if (typeof response === 'object') {
                    return response;
                }

                await delay(30_000);

            } catch (error) {
                console.error('Error checking status:', error);
                return null as any;
            }
        }

    }

}
