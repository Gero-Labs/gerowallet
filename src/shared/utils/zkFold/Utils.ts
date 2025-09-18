/**
 * Convert a hex string to a byte array
 * https://stackoverflow.com/questions/14603205/how-to-convert-hex-string-into-a-bytes-array-and-a-bytes-array-in-the-hex-strin
 */
export function hexToBytes(hex: string): Uint8Array {
    const bytes = [];
    for (let c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return Uint8Array.from(bytes);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert BigInt to byte array
 */
export function bigIntToBytes(bigInt: bigint): Uint8Array {
    const hex = bigInt.toString(16);
    const paddedHex = hex.length % 2 ? '0' + hex : hex;
    const bytes = new Uint8Array(paddedHex.length / 2);
    for (let i = 0; i < paddedHex.length; i += 2) {
        bytes[i / 2] = parseInt(paddedHex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Convert bytes to base64url string
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Harden a derivation index for BIP32 key derivation
 * @param num - Index to harden
 * @returns Hardened index
 */
export function harden(num: number): number {
    return 0x80000000 + num;
}

/**
 * Convert base64 string to BigInt (from zkFold implementation)
 * Based on: https://coolaj86.com/articles/bigints-and-base64-in-javascript/
 * @param b64 - Base64 string
 * @returns BigInt value
 */
export function b64ToBigInt(b64: string): bigint {
    const bin = atob(b64);
    const hex: string[] = [];

    bin.split('').forEach(function (ch) {
        let h = ch.charCodeAt(0).toString(16);
        if (h.length % 2) { h = '0' + h; }
        hex.push(h);
    });

    return BigInt('0x' + hex.join(''));
}

/**
 * Get matching Google public key by key ID
 * @param keyId - Key ID from JWT header
 * @returns Matching public key or null
 */
export async function getMatchingGoogleKey(keyId: string) {
    const { keys } = await fetch('https://www.googleapis.com/oauth2/v3/certs').then((res) => res.json());
    for (const k of keys) {
        if (k.kid == keyId) {
            return k;
        }
    }
    return null;
}