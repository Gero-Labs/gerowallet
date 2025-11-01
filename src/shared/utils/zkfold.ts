import { Bip32PrivateKey, Bip32PublicKeyHashHex } from '@cardano-sdk/crypto';
import zkFoldApi, { ProofInput, ProofBytes } from '@/api/zk-fold.api';

/**
 * Convert base64url to BigInt string for zkFold proof
 */
function base64urlToBigInt(base64url: string): string {
  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }

  // Decode to bytes
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Convert bytes to hex
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Convert hex to BigInt and return as string
  return BigInt('0x' + hex).toString();
}

/**
 * Extract signature from JWT (base64url encoded)
 */
function getJWTSignature(jwt: string): string {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  return base64urlToBigInt(parts[2]);
}

/**
 * Generate ProofInput for zkFold proof generation
 *
 * @param jwt - ID token from Google OAuth
 * @param paymentKey - Bip32PrivateKey for the payment key (m/1852'/1815'/0'/0/0)
 * @returns ProofInput object ready for proof generation
 */
export async function createProofInput(jwt: string, paymentKey: Bip32PrivateKey): Promise<ProofInput> {
  console.log('🔐 Creating proof input...');

  // Parse JWT to get header
  const { header } = zkFoldApi.parseJWT(jwt);
  const kid = header.kid;

  if (!kid) {
    throw new Error('JWT header missing kid (key ID)');
  }

  console.log('🔐 JWT Key ID:', kid);

  // Get Google's RSA public key for this kid
  const googleKey = await zkFoldApi.getGooglePublicKey(kid);
  console.log('🔐 Retrieved Google RSA public key');

  // Get JWT signature
  const jwtSignature = getJWTSignature(jwt);
  console.log('🔐 Extracted JWT signature');

  // Get payment key hash (this is the "token name" in zkFold's proof)
  const paymentPubKey = paymentKey.toPublic();
  const paymentKeyHashHex: Bip32PublicKeyHashHex = paymentPubKey.hash();
  console.log('🔐 Payment key hash:', paymentKeyHashHex);

  // Create ProofInput
  const proofInput: ProofInput = {
    piPubE: base64urlToBigInt(googleKey.e),
    piPubN: base64urlToBigInt(googleKey.n),
    piSignature: jwtSignature,
    piTokenName: '0x' + paymentKeyHashHex,
  };

  console.log('✅ Proof input created successfully');
  return proofInput;
}

/**
 * Generate ZK proof for wallet activation
 *
 * @param proverURL - URL of the zkFold prover service
 * @param jwt - ID token from Google OAuth
 * @param paymentKey - Bip32PrivateKey for the payment key
 * @param activationId - Optional activation ID for abort checking
 * @returns ProofBytes object
 */
export async function generateWalletProof(
  proverURL: string,
  jwt: string,
  paymentKey: Bip32PrivateKey,
  activationId?: string
): Promise<ProofBytes> {
  console.log('🔐 Starting wallet proof generation...');

  // Create proof input
  const proofInput = await createProofInput(jwt, paymentKey);

  // Generate proof (this will poll until complete)
  console.log('🔐 Sending to prover service (this may take several minutes)...');
  const proof = await zkFoldApi.generateProof(proverURL, proofInput, activationId);

  console.log('✅ Wallet proof generated successfully!');
  return proof;
}

/**
 * Get payment key hash from private key
 * This is used as the payment_key_hash parameter in zkFold API calls
 */
export function getPaymentKeyHash(paymentKey: Bip32PrivateKey): string {
  // .hash() already returns a hex string (Bip32PublicKeyHashHex)
  // No need to convert to Buffer and back to hex
  return paymentKey.toPublic().hash();
}

/**
 * Strip JWT signature (zkFold does this after proof generation)
 * Returns header.payload without signature
 */
export function stripJWTSignature(jwt: string): string {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  return `${parts[0]}.${parts[1]}`;
}
