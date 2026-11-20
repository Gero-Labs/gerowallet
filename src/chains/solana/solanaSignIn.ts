// Sign in with Solana (Wallet Standard `solana:signIn`, SIWS). The dApp sends its fields; the
// worker checks them and builds the message text exactly as @solana/wallet-standard-util's
// createSignInMessageText does, because the dApp verifies the signed text against its own input
// (verifySignIn): every optional field must be the dApp's own, so the wallet fills in only the
// two it may (domain and address) and never adds one.
//
// Checks, all fail closed:
//  - the domain, if given, is the requesting site's host (a site cannot sign the user in to
//    another one); if absent it is that host;
//  - the address, if given, is the account that signs; if absent it is that account;
//  - the chain, if given, is the wallet's network;
//  - no field breaks the message's lines (a newline would let a field forge another line);
//  - the request has not expired and is already valid.

export interface SolanaSignInFields {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

export type SolanaSignInRefusal =
  | 'INVALID'
  | 'DOMAIN_MISMATCH'
  | 'ADDRESS_MISMATCH'
  | 'CHAIN_MISMATCH'
  | 'EXPIRED'
  | 'NOT_YET_VALID';

const OPTIONAL = ['statement', 'uri', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime', 'notBefore', 'requestId'] as const;
const MAX_FIELD = 1024;
const MAX_RESOURCES = 32;
const LINE_BREAK = /[\r\n\u2028\u2029]/;

/** A Solana chain id as SIWS writes it ('mainnet', 'solana:mainnet', ...), reduced to the cluster. */
function cluster(chainId: string): string {
  return chainId.toLowerCase().replace(/^solana:/, '');
}

/**
 * The fields to sign for `input` from `originHost` (the requesting site's `host`, port
 * included) with `address` on `chain` ('solana:mainnet' / 'solana:devnet'), or why not.
 */
export function checkSolanaSignIn(
  input: unknown,
  ctx: { originHost: string; address: string; chain: string; now?: number },
): { ok: true; fields: SolanaSignInFields } | { ok: false; reason: SolanaSignInRefusal } {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) return { ok: false, reason: 'INVALID' };
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD && !LINE_BREAK.test(v);

  if (raw['domain'] !== undefined && !text(raw['domain'])) return { ok: false, reason: 'INVALID' };
  if (raw['address'] !== undefined && !text(raw['address'])) return { ok: false, reason: 'INVALID' };
  const fields: SolanaSignInFields = {
    domain: (raw['domain'] as string | undefined) ?? ctx.originHost,
    address: (raw['address'] as string | undefined) ?? ctx.address,
  };
  for (const key of OPTIONAL) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!text(value)) return { ok: false, reason: 'INVALID' };
    fields[key] = value;
  }
  if (raw['resources'] !== undefined) {
    const resources = raw['resources'];
    if (!Array.isArray(resources) || resources.length > MAX_RESOURCES || !resources.every(text)) return { ok: false, reason: 'INVALID' };
    fields.resources = [...resources];
  }

  if (fields.domain !== ctx.originHost) return { ok: false, reason: 'DOMAIN_MISMATCH' };
  if (fields.address !== ctx.address) return { ok: false, reason: 'ADDRESS_MISMATCH' };
  if (fields.chainId !== undefined && cluster(fields.chainId) !== cluster(ctx.chain)) return { ok: false, reason: 'CHAIN_MISMATCH' };

  const now = ctx.now ?? Date.now();
  for (const key of ['issuedAt', 'expirationTime', 'notBefore'] as const) {
    if (fields[key] !== undefined && Number.isNaN(Date.parse(fields[key] as string))) return { ok: false, reason: 'INVALID' };
  }
  if (fields.expirationTime !== undefined && Date.parse(fields.expirationTime) <= now) return { ok: false, reason: 'EXPIRED' };
  if (fields.notBefore !== undefined && Date.parse(fields.notBefore) > now) return { ok: false, reason: 'NOT_YET_VALID' };
  return { ok: true, fields };
}

/** The SIWS message text, line for line as @solana/wallet-standard-util's createSignInMessageText. */
export function solanaSignInMessageText(f: SolanaSignInFields): string {
  let message = `${f.domain} wants you to sign in with your Solana account:\n`;
  message += `${f.address}`;
  if (f.statement) message += `\n\n${f.statement}`;
  const lines: string[] = [];
  if (f.uri) lines.push(`URI: ${f.uri}`);
  if (f.version) lines.push(`Version: ${f.version}`);
  if (f.chainId) lines.push(`Chain ID: ${f.chainId}`);
  if (f.nonce) lines.push(`Nonce: ${f.nonce}`);
  if (f.issuedAt) lines.push(`Issued At: ${f.issuedAt}`);
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  if (f.notBefore) lines.push(`Not Before: ${f.notBefore}`);
  if (f.requestId) lines.push(`Request ID: ${f.requestId}`);
  if (f.resources) {
    lines.push('Resources:');
    for (const resource of f.resources) lines.push(`- ${resource}`);
  }
  if (lines.length) message += `\n\n${lines.join('\n')}`;
  return message;
}
