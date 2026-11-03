// Test-side listing rows for the browse and buy specs: a `ListingDto` whose `datumCbor` really is
// the datum its other fields name, so the page's own decoding (decodeListingDatum) runs on real
// bytes. The encoder mirrors the contract's types (`Listing` = Constr 0 [owner, Address, price,
// royalties, Option<buyer>]); it is only ever imported by specs.
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import type { ListingDto } from '@/api/nft-market-api';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const bstr = (h: string) => `58${hex2(h.length / 2)}${h}`;
const NONE = 'd87a80';

function uint(n: bigint): string {
  if (n < 24n) return n.toString(16).padStart(2, '0');
  if (n < 0x100n) return `18${n.toString(16).padStart(2, '0')}`;
  if (n < 0x10000n) return `19${n.toString(16).padStart(4, '0')}`;
  if (n < 0x100000000n) return `1a${n.toString(16).padStart(8, '0')}`;
  return `1b${n.toString(16).padStart(16, '0')}`;
}

/** `Constr index [fields]` as an indefinite-length list (index 0 and 1 only). */
const constr = (index: 0 | 1, fields: string[]) => `${index === 0 ? 'd879' : 'd87a'}9f${fields.join('')}ff`;

/** A preprod base address from a payment key hash and a stake key hash (both 56 hex). */
export function preprodAddress(payment: string, stake: string): string {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(payment), type: Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

function addressData(bech32: string): string {
  const base = Cardano.Address.fromBech32(bech32).asBase()!;
  const credential = (c: Cardano.Credential) => constr(c.type === Cardano.CredentialType.KeyHash ? 0 : 1, [bstr(c.hash)]);
  return constr(0, [credential(base.getPaymentCredential()), constr(0, [constr(0, [credential(base.getStakeCredential())])])]);
}

export interface RowOptions {
  /** Output index of the listing UTxO; also makes its out-ref and asset name distinct. */
  index?: number;
  /** Payment key hash of the owner (and of the seller address). Default: a stranger. */
  owner?: string;
  /** Stake key hash of the seller address. */
  stake?: string;
  /** The datum's `buyer` (56 hex), or null for a public listing. */
  buyer?: string | null;
  /** Price in ADA (whole). */
  priceAda?: number;
  policyId?: string;
  /** ASCII asset name. */
  assetName?: string;
  /** Lovelace deposit. */
  deposit?: string;
  /** Replaces the datum bytes entirely (an unreadable datum). */
  datumCbor?: string;
}

export const STRANGER_KEY = '77'.repeat(28);
export const STRANGER_STAKE = '88'.repeat(28);
export const DEFAULT_POLICY = 'cd'.repeat(28);

const asciiHex = (s: string) => [...s].map((c) => hex2(c.charCodeAt(0))).join('');

/** One open listing of a collection, as Nexus would list it, consistent with its own datum. */
export function listingRow(options: RowOptions = {}): ListingDto {
  const index = options.index ?? 0;
  const owner = options.owner ?? STRANGER_KEY;
  const stake = options.stake ?? STRANGER_STAKE;
  const priceLovelace = BigInt(options.priceAda ?? 120) * 1_000_000n;
  const policyId = options.policyId ?? DEFAULT_POLICY;
  const assetName = asciiHex(options.assetName ?? `Cat${index}`);
  const sellerAddress = preprodAddress(owner, stake);
  const buyer = options.buyer ?? null;
  const datumCbor =
    options.datumCbor ??
    constr(0, [
      bstr(owner),
      addressData(sellerAddress),
      uint(priceLovelace),
      '9fff',
      buyer === null ? NONE : constr(0, [bstr(buyer)]),
    ]);
  const deployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
  return {
    txHash: hex2(index + 1).repeat(32),
    outputIndex: 0,
    version: deployment.version,
    scriptHash: deployment.scriptHash,
    unit: policyId + assetName,
    policyId,
    assetName,
    priceLovelace: priceLovelace.toString(),
    feeLovelace: '1500000',
    royalties: [],
    depositLovelace: options.deposit ?? '1550000',
    sellerAddress,
    ownerPkh: owner,
    listedSlot: 1000 + index,
    datumCbor,
  };
}

/** The out-ref of a row, `txHash#index`. */
export const refOf = (row: Pick<ListingDto, 'txHash' | 'outputIndex'>): string => `${row.txHash}#${row.outputIndex}`;
