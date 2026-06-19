/**
 * Lightning Network LNURL & BOLT11 utilities
 * Supports:
 * - Lightning addresses (user@domain.com)
 * - LNURL-pay endpoint resolution
 * - BOLT11 invoice decoding (basic)
 */

import axios from 'axios';

export interface LnurlPayEndpoint {
  callback: string;
  maxSendable: number;     // millisatoshis
  minSendable: number;     // millisatoshis
  metadata: string;        // JSON array of [type, value] pairs
  tag: 'payRequest';
  commentAllowed?: number;
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

export interface LnurlPayInvoice {
  pr: string;              // BOLT11 payment request
  routes: string[];
}

export interface Bolt11Decoded {
  paymentHash: string;
  amount: number | null;   // millisatoshis or null if any-amount
  description: string | null;
  timestamp: number;
  expiry: number;          // seconds
  payeePubkey: string | null;
  network: 'mainnet' | 'testnet' | 'simnet';
  raw: string;
}

export interface LnAddressResolveResult {
  type: 'lnaddress' | 'lnurl' | 'bolt11' | 'unknown';
  lnurlEndpoint?: LnurlPayEndpoint;
  bolt11?: Bolt11Decoded;
  error?: string;
}

class LightningApi {
  /**
   * Resolve a Lightning address (user@domain.com) to its LNURL-pay endpoint
   */
  async resolveLightningAddress(address: string): Promise<LnurlPayEndpoint> {
    const [user, domain] = address.split('@');
    if (!user || !domain) throw new Error('Invalid Lightning address format');

    const url = `https://${domain}/.well-known/lnurlp/${user}`;
    const { data } = await axios.get(url);

    if (data.tag !== 'payRequest') {
      throw new Error('Not a LNURL-pay endpoint');
    }

    return data as LnurlPayEndpoint;
  }

  /**
   * Decode a bech32-encoded LNURL string to get the endpoint URL
   */
  decodeLnurl(lnurl: string): string {
    // LNURL is bech32 encoded with 'lnurl' prefix
    // Simple decoder: strip prefix and decode bytes to UTF-8 URL
    try {
      const lower = lnurl.toLowerCase();
      if (!lower.startsWith('lnurl1')) throw new Error('Not a valid LNURL');

      // Use native bech32 decoding via the bech32 library if available,
      // otherwise fall back to a basic implementation
      const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

      const data = lower.substring(6); // strip 'lnurl1'
      const decoded: number[] = [];
      for (const char of data) {
        const p = CHARSET.indexOf(char);
        if (p < 0) continue;
        decoded.push(p);
      }

      // Convert from 5-bit groups to 8-bit bytes
      const bytes: number[] = [];
      let acc = 0, bits = 0;
      for (let i = 0; i < decoded.length - 6; i++) { // strip checksum
        acc = (acc << 5) | decoded[i];
        bits += 5;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((acc >> bits) & 0xff);
        }
      }

      return new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      throw new Error('Failed to decode LNURL');
    }
  }

  /**
   * Fetch a LNURL-pay endpoint (either from decoded LNURL or direct URL)
   */
  async fetchLnurlPayEndpoint(url: string): Promise<LnurlPayEndpoint> {
    const { data } = await axios.get(url);
    if (data.tag !== 'payRequest') {
      throw new Error('URL did not return a LNURL-pay endpoint');
    }
    return data as LnurlPayEndpoint;
  }

  /**
   * Request a BOLT11 invoice from a LNURL-pay endpoint
   */
  async requestInvoice(endpoint: LnurlPayEndpoint, amountMsats: number, comment?: string): Promise<LnurlPayInvoice> {
    const params: Record<string, string> = { amount: String(amountMsats) };
    if (comment && endpoint.commentAllowed) {
      params['comment'] = comment.slice(0, endpoint.commentAllowed);
    }

    const { data } = await axios.get(endpoint.callback, { params });
    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL endpoint returned error');
    }
    return data as LnurlPayInvoice;
  }

  /**
   * Parse metadata from LNURL-pay endpoint to extract description and image
   */
  parseMetadata(metadataJson: string): { description: string; image?: string } {
    try {
      const entries: [string, string][] = JSON.parse(metadataJson);
      const description = entries.find(e => e[0] === 'text/plain')?.[1] || '';
      const image = entries.find(e => e[0] === 'image/png;base64' || e[0] === 'image/jpeg;base64')?.[1];
      return { description, image: image ? `data:image/png;base64,${image}` : undefined };
    } catch {
      return { description: '' };
    }
  }

  /**
   * Detect the type of Lightning string input
   */
  detectInputType(input: string): 'lnaddress' | 'lnurl' | 'bolt11' | 'unknown' {
    const lower = input.toLowerCase().trim();
    if (lower.includes('@') && !lower.startsWith('lnurl') && !lower.startsWith('ln')) {
      return 'lnaddress';
    }
    if (lower.startsWith('lnurl')) {
      return 'lnurl';
    }
    if (lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')) {
      return 'bolt11';
    }
    return 'unknown';
  }

  /**
   * Decode a BOLT11 invoice (minimal decoder without full bech32 parsing)
   * Returns basic info extractable from the invoice prefix
   */
  decodeBolt11Basic(invoice: string): Partial<Bolt11Decoded> {
    const lower = invoice.toLowerCase();

    let network: 'mainnet' | 'testnet' | 'simnet' = 'mainnet';
    if (lower.startsWith('lntb')) network = 'testnet';
    else if (lower.startsWith('lnbcrt')) network = 'simnet';

    // Extract amount from invoice prefix (e.g., lnbc10m = 10 mBTC)
    let amount: number | null = null;
    const match = lower.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      const multipliers: Record<string, number> = { m: 100000000, u: 100000, n: 100, p: 0.1 };
      const multiplier = unit ? multipliers[unit] || 1 : 100000000000; // sats in msats
      amount = Math.round(value * multiplier);
    }

    return {
      raw: invoice,
      network,
      amount,
      timestamp: Math.floor(Date.now() / 1000),
      expiry: 3600, // default
    };
  }

  /** Format millisatoshis to readable string */
  formatMsats(msats: number): string {
    const sats = msats / 1000;
    if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(4)} BTC`;
    if (sats >= 1_000) return `${(sats / 1_000).toLocaleString()} k sats`;
    return `${sats.toLocaleString()} sats`;
  }

  /** Resolve any Lightning input (address, LNURL, or BOLT11) */
  async resolve(input: string): Promise<LnAddressResolveResult> {
    const type = this.detectInputType(input.trim());

    try {
      if (type === 'lnaddress') {
        const endpoint = await this.resolveLightningAddress(input.trim());
        return { type, lnurlEndpoint: endpoint };
      } else if (type === 'lnurl') {
        const url = this.decodeLnurl(input.trim());
        const endpoint = await this.fetchLnurlPayEndpoint(url);
        return { type, lnurlEndpoint: endpoint };
      } else if (type === 'bolt11') {
        const decoded = this.decodeBolt11Basic(input.trim());
        return { type, bolt11: decoded as Bolt11Decoded };
      }
      return { type: 'unknown', error: 'Unrecognized Lightning format' };
    } catch (e: any) {
      return { type, error: e.message || 'Failed to resolve Lightning input' };
    }
  }
}

export const lightningApi = new LightningApi();
export default lightningApi;