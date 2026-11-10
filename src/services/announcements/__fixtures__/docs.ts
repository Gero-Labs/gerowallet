// Test support: announcement documents and a signer, mirroring gero-sync's Docs.java and
// TestSigner.java so both sides test the same shapes.
//
// The keys are the RFC 8032 section 7.1 test keys. Their private halves are public knowledge: they
// exist for tests and the shared vectors only and must never be pinned in announcementKeys.ts.

import * as ed25519 from '@noble/ed25519';
import { hexToBytes } from '@/services/notify/notifyAuth';
import type { Envelope, VerifyKeys } from '../announcementVerify';

export const NOW = 1_794_400_000_000;
export const ID = '01JC0000000000000000000001';
export const SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const EDITORIAL_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const EDITORIAL_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const FEED_SEED = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
const FEED_PUB = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c';

/** The test keys, as the verifier takes them. Injected by tests; never the build's pinned lists. */
export const TEST_KEYS: VerifyKeys = {
  editorial: [{ keyId: 'vec-ed', publicKeyHex: EDITORIAL_PUB }],
  feed: [{ keyId: 'vec-feed', publicKeyHex: FEED_PUB }],
};

export type Doc = Record<string, unknown>;

const locale = (title: string, summary: string, body: string) => ({ title, summary, body });

/** A full editorial document: service + critical, two locales, one image used as thumb and in the body. */
export function editorial(): Doc {
  return {
    v: 1,
    id: ID,
    kind: 'service',
    severity: 'critical',
    ts: NOW - 3_600_000,
    exp: NOW + 6 * 24 * 3_600_000,
    audience: { platforms: ['extension', 'ios', 'android'], networks: ['cardano-mainnet'], minVersion: { extension: '2.9.0' } },
    content: {
      en: locale('Mainnet sync is delayed', 'Balances may lag by a few minutes.', `## What happened\n\n![chart](media:${SHA})\n`),
      de: locale('Mainnet-Synchronisierung verzögert', 'Guthaben können einige Minuten zurückliegen.', '## Was ist passiert\n'),
    },
    thumb: SHA,
    media: [{ sha256: SHA, type: 'image/png', bytes: 4, w: 1200, h: 630 }],
    action: { route: '/staking' },
  };
}

/** A feed-tier headline: news + info, no body, a gerowallet.io link. */
export function feed(): Doc {
  const d = editorial();
  d['kind'] = 'news';
  d['severity'] = 'info';
  d['content'] = { en: { title: 'Gero Wallet adds a market for NFTs', summary: 'Read how listing and buying work' } };
  delete d['thumb'];
  delete d['media'];
  d['action'] = { url: 'https://gerowallet.io/blog/nft-market' };
  return d;
}

/** The object at `path`, for mutating a document in place. */
export function at(doc: Doc, ...path: string[]): Doc {
  let cur = doc;
  for (const p of path) cur = cur[p] as Doc;
  return cur;
}

export function bytes(doc: Doc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc));
}

export function b64(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(seedHex: string, keyId: string, payload: Uint8Array): Promise<Envelope> {
  const domain = new TextEncoder().encode('gero-announcement-v1\n');
  const message = new Uint8Array(domain.length + payload.length);
  message.set(domain, 0);
  message.set(payload, domain.length);
  return { payload: b64(payload), keyId, sig: b64(await ed25519.signAsync(message, hexToBytes(seedHex))) };
}

export const signEditorial = (doc: Doc | Uint8Array): Promise<Envelope> => sign(EDITORIAL_SEED, 'vec-ed', doc instanceof Uint8Array ? doc : bytes(doc));
export const signFeed = (doc: Doc | Uint8Array): Promise<Envelope> => sign(FEED_SEED, 'vec-feed', doc instanceof Uint8Array ? doc : bytes(doc));
