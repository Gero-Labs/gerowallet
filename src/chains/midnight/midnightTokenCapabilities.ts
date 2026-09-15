/** Shielded and unshielded colors are distinct assets in the Midnight ledger. */
export function assertNativeNightConversionSupported(): never {
  throw new Error('NIGHT is a public token. Converting it to a private token requires an application contract.');
}

export function validateShieldedTokenType(tokenType: string): string {
  if (tokenType === 'native' || /^0{64}$/.test(tokenType)) {
    throw new Error('NIGHT is an unshielded token and cannot be sent as a shielded token.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(tokenType)) throw new Error('Invalid shielded token type');
  return tokenType.toLowerCase();
}
