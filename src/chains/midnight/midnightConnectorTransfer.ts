import { bech32m } from 'bech32';

export interface MidnightConnectorOutput {
  kind: 'unshielded';
  type: string;
  value: string;
  recipient: string;
}

export type MidnightConnectorTransferValidation =
  | { ok: true; outputs: MidnightConnectorOutput[] }
  | { ok: false; reason: string };

/** The bech32m prefix of an unshielded address on `network` (`mn_addr` on mainnet). */
export function unshieldedAddressPrefix(network: string): string {
  const sdkNetwork = network.toLowerCase();
  return sdkNetwork === 'mainnet' ? 'mn_addr' : `mn_addr_${sdkNetwork}`;
}

/** True for a bech32m unshielded address with `prefix` and a 32-byte payload. */
export function isUnshieldedRecipient(recipient: unknown, prefix: string): recipient is string {
  try {
    if (typeof recipient !== 'string') return false;
    const decoded = bech32m.decode(recipient, 1024);
    return decoded.prefix === prefix && bech32m.fromWords(decoded.words).length === 32;
  } catch {
    return false;
  }
}

/** Validate and normalize public outputs before displaying a signing prompt. */
export function validateMidnightConnectorTransfer(data: unknown, network: string): MidnightConnectorTransferValidation {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'Invalid transfer request' };
  const request = data as { desiredOutputs?: unknown; options?: unknown };
  if (!Array.isArray(request.desiredOutputs) || !request.desiredOutputs.length) {
    return { ok: false, reason: 'desiredOutputs must be a non-empty array' };
  }
  if (request.desiredOutputs.length > 100) return { ok: false, reason: 'too many outputs (max 100 per transfer)' };
  if (request.options !== undefined) {
    if (!request.options || typeof request.options !== 'object' || Array.isArray(request.options)) {
      return { ok: false, reason: 'Invalid transfer options' };
    }
    const payFees = (request.options as { payFees?: unknown }).payFees;
    if (payFees !== undefined && payFees !== true) {
      return { ok: false, reason: 'GeroWallet must pay the DUST fee for this connector transfer' };
    }
  }
  const sdkNetwork = network.toLowerCase();
  if (!['mainnet', 'preprod', 'stagenet', 'testnet'].includes(sdkNetwork)) {
    return { ok: false, reason: 'Unsupported Midnight network' };
  }
  const prefix = unshieldedAddressPrefix(sdkNetwork);
  const outputs: MidnightConnectorOutput[] = [];
  for (const raw of request.desiredOutputs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'Each desiredOutput must be an object' };
    const output = raw as { kind?: unknown; type?: unknown; value?: unknown; recipient?: unknown };
    if (output.kind !== 'unshielded') return { ok: false, reason: 'Only public-token transfers are supported by makeTransfer' };
    const type = output.type === undefined || output.type === '' ? '00'.repeat(32) : output.type;
    if (typeof type !== 'string' || !/^[0-9a-fA-F]{64}$/.test(type)) {
      return { ok: false, reason: 'Token type must be a 32-byte hexadecimal color' };
    }
    // The bridge sends bigint amounts as decimal strings. Bound parsing work
    // and reject JavaScript coercions such as true, hex strings and whitespace.
    if (typeof output.value !== 'string' || !/^[0-9]{1,80}$/.test(output.value) || BigInt(output.value) <= 0n) {
      return { ok: false, reason: 'Amount must be a positive decimal integer' };
    }
    if (!isUnshieldedRecipient(output.recipient, prefix)) {
      return { ok: false, reason: 'Recipient must be a valid public address on the connected Midnight network' };
    }
    outputs.push({ kind: 'unshielded', type: type.toLowerCase(), value: BigInt(output.value).toString(), recipient: output.recipient as string });
  }
  return { ok: true, outputs };
}

/** Unknown private state must never be returned as an authoritative empty map. */
export function syncedMidnightShieldedBalances(status: string, balances: Record<string, bigint> = {}): Record<string, string> {
  if (status !== 'synced') throw new Error('Private balances are not synchronized; unlock private token synchronization in the wallet before retrying');
  return Object.fromEntries(Object.entries(balances).filter(([, amount]) => amount > 0n)
    .map(([color, amount]) => [color, amount.toString()]));
}
