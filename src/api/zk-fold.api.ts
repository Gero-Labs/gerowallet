import axios from 'axios';
import JSONbig from 'json-bigint';

// Configure JSONbig to match zkfold SDK serialization behavior
// This preserves large numbers without scientific notation
const JSONbigConfig = JSONbig({
  storeAsString: false,
  useNativeBigInt: true
});

/**
 * Convert scientific notation string to decimal string
 * e.g., "1.0369087917667743e+76" -> "103690879176677430000000000000000000000000000000000000000000000000000000000000"
 */
function scientificToDecimal(num: number): string {
  const str = num.toString();

  // If not in scientific notation, return as is
  if (!str.includes('e')) {
    return Math.floor(num).toString();
  }

  // Parse scientific notation
  const [coefficient, exponent] = str.split('e');
  const exp = parseInt(exponent, 10);

  // Remove decimal point from coefficient
  const [intPart, decPart = ''] = coefficient.split('.');
  const digits = intPart.replace('-', '') + decPart;
  const isNegative = coefficient.startsWith('-');

  let result: string;
  if (exp >= 0) {
    // Positive exponent - add zeros to the right
    const zerosToAdd = exp - decPart.length;
    result = digits + '0'.repeat(Math.max(0, zerosToAdd));
  } else {
    // Negative exponent - add zeros to the left
    const zerosToAdd = Math.abs(exp) - intPart.length + 1;
    result = '0.' + '0'.repeat(Math.max(0, zerosToAdd)) + digits;
  }

  return isNegative ? '-' + result : result;
}

/**
 * Convert JavaScript numbers to bigint recursively
 * This is needed because json-bigint only preserves precision for bigint types
 */
function convertNumbersToBigInt(obj: any): any {
  if (typeof obj === 'number') {
    // Convert scientific notation numbers to bigint
    const decimalStr = scientificToDecimal(obj);
    // Remove any decimal part for integer conversion
    const integerStr = decimalStr.split('.')[0];
    return BigInt(integerStr);
  } else if (Array.isArray(obj)) {
    return obj.map(convertNumbersToBigInt);
  } else if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertNumbersToBigInt(value);
    }
    return result;
  }
  return obj;
}

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000, // 2 minutes for regular API calls
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

// Types
export interface ProofInput {
  piPubE: string; // BigInt as string
  piPubN: string; // BigInt as string
  piSignature: string; // BigInt as string
  piTokenName: string; // BigInt as string (with 0x prefix)
}

export interface ProofBytes {
  tag: 'Completed';
  contents: any;
}

export interface CreateWalletResponse {
  address: string;
  tx: string; // CBOR hex
  tx_fee: string;
}

export interface SendFundsResponse {
  tx: string; // CBOR hex
  tx_fee: string;
}

export interface SubmitTxResult {
  tx_hash: string;
}

export interface GoogleJWKS {
  keys: Array<{
    kid: string;
    n: string; // RSA modulus (base64url)
    e: string; // RSA exponent (base64url)
    kty: string;
    alg: string;
    use: string;
  }>;
}

export default {
  /**
   * Get wallet address for a given Gmail
   */
  async walletAddress(gmail: string) {
    return axiosInstance.get(`/api/zkfold/walletAddress/${encodeURIComponent(gmail)}`);
  },

  /**
   * Activate a new wallet with ZK proof
   */
  async activateWallet(jwt: string, paymentKeyHash: string, proofBytes: ProofBytes): Promise<CreateWalletResponse> {
    console.log('🔐 activateWallet - paymentKeyHash:', paymentKeyHash);
    console.log('🔐 activateWallet - paymentKeyHash type:', typeof paymentKeyHash);
    console.log('🔐 activateWallet - paymentKeyHash length:', paymentKeyHash.length);

    // Extract the bytes object from the ProofBytes wrapper
    // zkFold API expects just the bytes object, not the full wrapper
    const proofBytesData = proofBytes.contents.bytes;

    // Convert all numbers to bigint so json-bigint can preserve precision
    const proofBytesDataBigInt = convertNumbersToBigInt(proofBytesData);

    const requestBody = {
      jwt,
      payment_key_hash: paymentKeyHash,
      proof_bytes: proofBytesDataBigInt,
    };
    console.log('🔐 activateWallet - requestBody (with bigints):', requestBody);

    // Use JSONbig to serialize - matches zkfold SDK behavior
    // This preserves large numbers as unquoted JSON numbers without scientific notation
    const serializedBody = JSONbigConfig.stringify(requestBody);
    console.log('🔐 Serialized JSON (first 500 chars):', serializedBody.substring(0, 500));
    console.log('🔐 Full JSON length:', serializedBody.length);

    // Log a sample of the proof_bytes to verify format
    const proofBytesStart = serializedBody.indexOf('"proof_bytes"');
    if (proofBytesStart !== -1) {
      console.log('🔐 proof_bytes section (500 chars):', serializedBody.substring(proofBytesStart, proofBytesStart + 500));
    }

    const { data } = await axiosInstance.post('/api/zkfold/wallet/activate', serializedBody, {
      headers: {
        'Content-Type': 'application/json',
      },
      // transformRequest must be set to undefined/array with identity function
      // to prevent Axios from re-serializing our already-serialized string
      transformRequest: [(data) => data],
    });
    return data;
  },

  /**
   * Activate wallet and send funds in one transaction
   */
  async activateAndSendFunds(
    jwt: string,
    paymentKeyHash: string,
    proofBytes: ProofBytes,
    outputs: Array<{ address: string; lovelace: string }>
  ): Promise<CreateWalletResponse> {
    // Extract the bytes object from the ProofBytes wrapper
    const proofBytesData = proofBytes.contents.bytes;

    const { data } = await axiosInstance.post('/api/zkfold/wallet/activate-and-send-funds', {
      jwt,
      payment_key_hash: paymentKeyHash,
      proof_bytes: proofBytesData,
      outs: outputs,
    });
    return data;
  },

  /**
   * Send funds from activated wallet
   */
  async sendFunds(
    email: string,
    outputs: Array<{ address: string; lovelace: string }>,
    paymentKeyHash: string
  ): Promise<SendFundsResponse> {
    const { data } = await axiosInstance.post('/api/zkfold/wallet/send-funds', {
      email,
      outs: outputs,
      payment_key_hash: paymentKeyHash,
    });
    return data;
  },

  /**
   * Submit a signed transaction to the blockchain
   */
  async submitTx(transaction: string, emailRecipients?: string[], sender?: string): Promise<SubmitTxResult> {
    const { data } = await axiosInstance.post('/api/zkfold/tx/submit', {
      transaction,
      email_recipients: emailRecipients,
      sender,
    });
    return data;
  },

  /**
   * Add vkey witness and submit transaction
   */
  async addVkeyAndSubmitTx(
    unsignedTransaction: string,
    vkeyWitness: string,
    emailRecipients?: string[],
    sender?: string
  ): Promise<SubmitTxResult> {
    const { data } = await axiosInstance.post('/api/zkfold/tx/add-vkey-and-submit', {
      unsigned_transaction: unsignedTransaction,
      vkey_witness: vkeyWitness,
      email_recipients: emailRecipients,
      sender,
    });
    return data;
  },

  /**
   * Get UTxOs for addresses
   */
  async getAddressUtxos(addresses: string[]): Promise<any[]> {
    const { data } = await axiosInstance.post('/api/zkfold/address/utxos', addresses);
    return data;
  },

  /**
   * Request proof generation from prover service
   * Returns proof ID for polling
   *
   * NOTE: This now uses the backend proxy for encryption
   * The backend handles AES-256-CBC + RSA-OAEP encryption
   */
  async requestProof(proverURL: string, proofInput: ProofInput): Promise<string> {
    console.log('🔐 Requesting proof via backend proxy...');

    const { data } = await axiosInstance.post('/api/zkfold/prove', {
      proof_input: proofInput,
      prover_url: proverURL,
    });

    return data.proof_id || data;
  },

  /**
   * Check proof generation status
   *
   * NOTE: This now uses the backend proxy
   * Set VITE_USE_MOCK_PROOF=true in .env to skip proof generation (for faster development)
   */
  async getProofStatus(proofId: string): Promise<ProofBytes | null> {
    // Mock proof for development
    //@ts-ignore
    const useMockProof = import.meta.env.VITE_USE_MOCK_PROOF === 'true';
    if (useMockProof) {
      console.log('🧪 Using mock proof (development mode)');
      // IMPORTANT: Use BigInt for large numbers to match real zkFold prover response
      // JavaScript numbers lose precision beyond 15-17 digits
      return {
        tag: 'Completed',
        contents: {
          bytes: {
            a_xi_int: BigInt("10369087917667743000000000000000000000000000000000000000000000000000000000000"),
            b_xi_int: BigInt("27054536419423700000000000000000000000000000000000000000000000000000000000000"),
            c_xi_int: BigInt("34624254941194195000000000000000000000000000000000000000000000000000000000000"),
            cmA_bytes: "b3cc43b5cfbc9c747c8ac1a22e241cf25e8c8f69a5e2538a310793523cb473453d711e0c3a308ab7d79422c241c995f2",
            cmB_bytes: "a8aafb653a69ddfc94551a6d41ec4b559cd2e5a3513e45040e1d5f97123c9a056fb9744760bcb1c1a554828ec3c29d8a",
            cmC_bytes: "93be6ea236059013068c2f92182534bae1298f54667f51d4d8681a5b22b9b2d4b3721b8eb0e59641b30f44beebee9d33",
            cmF_bytes: "8d372a5105e3997d4e2da27b14dbc596c92f31da676b00e79e3d4f9434ebf0a0cc47d320ae3632c89a43f79cf6b4f65a",
            cmH1_bytes: "b50f069516c94024076b72872723b0e347474a432324ce564059801dc64f96163758f3534e002c7806fedec717daf25e",
            cmH2_bytes: "935eb47766b5b69764038d4afedebb98f48fb4c2a05aaf271aec5cfa561bb5e9ecdea4116b0c8e971b8b17a0e4def6ad",
            cmQhigh_bytes: "86aa5f4a0539141527778bf3a7026c1b0e071dd8dbf891b496a54c3b9372ed63b94ad5ada2da8eb33ae6d44de904027c",
            cmQlow_bytes: "a490ff0fd97abccdaf49a24e33b94a51607c5c517b52069f9afeade5634b0a9c2e310b537db73785e3af503d5d2a66fc",
            cmQmid_bytes: "881d36cdd9f5263e7aba55ec43b955c2c2c32d654128cb758a8e842f938764bd3a0c8b0ca881739c4311ddb7d9cbca69",
            cmZ1_bytes: "b59ed0fbbdb7f2ce39c9c443cdf5e79ec0f6dd027fe07c6b3aa947d93a91fdb736a0616599bc621eea34b60d68342af6",
            cmZ2_bytes: "9753b495a83eb08219d11b558e0f8f0af58841949b6516be303f89d2f2309fcf61f8e87bd3479f0d9140f9244d0eb239",
            f_xi_int: BigInt("40577616043738320000000000000000000000000000000000000000000000000000000000000"),
            "h1_xi'_int": BigInt("47318463801707160000000000000000000000000000000000000000000000000000000000000"),
            h2_xi_int: BigInt("40094672332155670000000000000000000000000000000000000000000000000000000000000"),
            l1_xi: BigInt("26261489428825202000000000000000000000000000000000000000000000000000000000000"),
            l_xi: [BigInt("26261489428825202000000000000000000000000000000000000000000000000000000000000"), BigInt("25825130003235480000000000000000000000000000000000000000000000000000000000000")],
            proof1_bytes: "93699f153498360d719deae88c72465d5f2fac4a21bcddfd85e55a866ff10b0df04e748a3f1a2457c1a9b6c27446e5ef",
            proof2_bytes: "815bf5461bfddb85b9e279c62f8853d0d348237d85323e1a1e11b3e41721437af360382ffe44cbcdae626a93a796fd64",
            s1_xi_int: BigInt("7642792286692584000000000000000000000000000000000000000000000000000000000000"),
            s2_xi_int: BigInt("39372140632171220000000000000000000000000000000000000000000000000000000000000"),
            "t_xi'_int": BigInt("14415653815900500000000000000000000000000000000000000000000000000000000000000"),
            t_xi_int: BigInt("31586366861433140000000000000000000000000000000000000000000000000000000000000"),
            "z1_xi'_int": BigInt("35566238322507134000000000000000000000000000000000000000000000000000000000000"),
            "z2_xi'_int": BigInt("35449536929482990000000000000000000000000000000000000000000000000000000000000")
          },
          timestamp: "2025-10-28T08:12:26.317733851Z"
        }
      } as ProofBytes;
    }

    const { data } = await axiosInstance.get(`/api/zkfold/proof-status/${proofId}`);
    if (typeof data === 'string' && data === 'Pending') {
      return null;
    }
    return data as ProofBytes;
  },

  /**
   * Generate proof (blocking - polls until complete)
   * @param proverURL - URL of the prover service
   * @param proofInput - Input data for proof generation
   * @param activationId - Optional activation ID for abort checking
   */
  async generateProof(proverURL: string, proofInput: ProofInput, activationId?: string): Promise<ProofBytes> {
    // Use mock proof for development (skip proof generation entirely)
    //@ts-ignore
    const useMockProof = import.meta.env.VITE_USE_MOCK_PROOF === 'true';
    if (useMockProof) {
      console.log('🧪 Using mock proof (skipping proof generation for faster development)');
      // Cleanup activation ID from storage
      if (activationId) {
        await chrome.storage.local.remove(`activation_${activationId}`);
      }
      // IMPORTANT: Use BigInt for large numbers to match real zkFold prover response
      return {
        tag: 'Completed',
        contents: {
          bytes: {
            a_xi_int: BigInt("10369087917667743000000000000000000000000000000000000000000000000000000000000"),
            b_xi_int: BigInt("27054536419423700000000000000000000000000000000000000000000000000000000000000"),
            c_xi_int: BigInt("34624254941194195000000000000000000000000000000000000000000000000000000000000"),
            cmA_bytes: "b3cc43b5cfbc9c747c8ac1a22e241cf25e8c8f69a5e2538a310793523cb473453d711e0c3a308ab7d79422c241c995f2",
            cmB_bytes: "a8aafb653a69ddfc94551a6d41ec4b559cd2e5a3513e45040e1d5f97123c9a056fb9744760bcb1c1a554828ec3c29d8a",
            cmC_bytes: "93be6ea236059013068c2f92182534bae1298f54667f51d4d8681a5b22b9b2d4b3721b8eb0e59641b30f44beebee9d33",
            cmF_bytes: "8d372a5105e3997d4e2da27b14dbc596c92f31da676b00e79e3d4f9434ebf0a0cc47d320ae3632c89a43f79cf6b4f65a",
            cmH1_bytes: "b50f069516c94024076b72872723b0e347474a432324ce564059801dc64f96163758f3534e002c7806fedec717daf25e",
            cmH2_bytes: "935eb47766b5b69764038d4afedebb98f48fb4c2a05aaf271aec5cfa561bb5e9ecdea4116b0c8e971b8b17a0e4def6ad",
            cmQhigh_bytes: "86aa5f4a0539141527778bf3a7026c1b0e071dd8dbf891b496a54c3b9372ed63b94ad5ada2da8eb33ae6d44de904027c",
            cmQlow_bytes: "a490ff0fd97abccdaf49a24e33b94a51607c5c517b52069f9afeade5634b0a9c2e310b537db73785e3af503d5d2a66fc",
            cmQmid_bytes: "881d36cdd9f5263e7aba55ec43b955c2c2c32d654128cb758a8e842f938764bd3a0c8b0ca881739c4311ddb7d9cbca69",
            cmZ1_bytes: "b59ed0fbbdb7f2ce39c9c443cdf5e79ec0f6dd027fe07c6b3aa947d93a91fdb736a0616599bc621eea34b60d68342af6",
            cmZ2_bytes: "9753b495a83eb08219d11b558e0f8f0af58841949b6516be303f89d2f2309fcf61f8e87bd3479f0d9140f9244d0eb239",
            f_xi_int: BigInt("40577616043738320000000000000000000000000000000000000000000000000000000000000"),
            "h1_xi'_int": BigInt("47318463801707160000000000000000000000000000000000000000000000000000000000000"),
            h2_xi_int: BigInt("40094672332155670000000000000000000000000000000000000000000000000000000000000"),
            l1_xi: BigInt("26261489428825202000000000000000000000000000000000000000000000000000000000000"),
            l_xi: [BigInt("26261489428825202000000000000000000000000000000000000000000000000000000000000"), BigInt("25825130003235480000000000000000000000000000000000000000000000000000000000000")],
            proof1_bytes: "93699f153498360d719deae88c72465d5f2fac4a21bcddfd85e55a866ff10b0df04e748a3f1a2457c1a9b6c27446e5ef",
            proof2_bytes: "815bf5461bfddb85b9e279c62f8853d0d348237d85323e1a1e11b3e41721437af360382ffe44cbcdae626a93a796fd64",
            s1_xi_int: BigInt("7642792286692584000000000000000000000000000000000000000000000000000000000000"),
            s2_xi_int: BigInt("39372140632171220000000000000000000000000000000000000000000000000000000000000"),
            "t_xi'_int": BigInt("14415653815900500000000000000000000000000000000000000000000000000000000000000"),
            t_xi_int: BigInt("31586366861433140000000000000000000000000000000000000000000000000000000000000"),
            "z1_xi'_int": BigInt("35566238322507134000000000000000000000000000000000000000000000000000000000000"),
            "z2_xi'_int": BigInt("35449536929482990000000000000000000000000000000000000000000000000000000000000")
          },
          timestamp: "2025-10-28T08:12:26.317733851Z"
        }
      } as ProofBytes;
    }

    console.log('🔐 Requesting proof generation...');
    const proofId = await this.requestProof(proverURL, proofInput);
    console.log('🔐 Proof ID:', proofId);

    // Poll for proof completion
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes max (10 seconds * 60)

    while (attempts < maxAttempts) {
      // Check if activation was aborted (if activationId provided)
      if (activationId) {
        const result = await chrome.storage.local.get(`activation_${activationId}`);
        const activation = result[`activation_${activationId}`];
        if (activation && !activation.active) {
          console.log('🚫 Proof generation aborted by user');
          throw new Error('Proof generation cancelled by user');
        }
      }

      console.log(`🔐 Checking proof status (attempt ${attempts + 1}/${maxAttempts})...`);
      const proof = await this.getProofStatus(proofId);

      if (proof) {
        console.log('✅ Proof generated successfully!');
        // Cleanup activation ID from storage
        if (activationId) {
          await chrome.storage.local.remove(`activation_${activationId}`);
        }
        return proof;
      }

      // Wait 10 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;
    }

    // Cleanup activation ID from storage on timeout
    if (activationId) {
      await chrome.storage.local.remove(`activation_${activationId}`);
    }

    throw new Error('Proof generation timed out after 10 minutes');
  },

  /**
   * Get Google's public keys (JWKS) for JWT verification
   */
  async getGoogleJWKS(): Promise<GoogleJWKS> {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/certs');
    return data;
  },

  /**
   * Parse JWT and extract header/payload
   */
  parseJWT(jwt: string): { header: any; payload: any; signature: string } {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const signature = parts[2];

    return { header, payload, signature };
  },

  /**
   * Get Google's RSA public key for a specific kid (key ID)
   */
  async getGooglePublicKey(kid: string): Promise<{ n: string; e: string }> {
    const jwks = await this.getGoogleJWKS();
    const key = jwks.keys.find(k => k.kid === kid);
    if (!key) {
      throw new Error(`Google public key not found for kid: ${kid}`);
    }
    return { n: key.n, e: key.e };
  },
}
