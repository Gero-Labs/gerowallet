// src/utils/networks.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Blockchain, Network } from '@/models/types';

// networks.ts normalizes the CIP-113 deployment constants at module scope, so every case
// needs a fresh module instance — hence vi.resetModules() alongside the doMock.
//
// A syntactically valid (56-hex, lowercase) stand-in for exercising the parsing and
// normalization below. Not a shipped value — it is the removed earlier preprod bootstrap.
const VALID_PREPROD = 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d';

/** Stub the deployment constants, then load a fresh networks.ts that reads them. */
async function loadNetworks(deployments: {
  mainnet?: readonly string[];
  preprod?: readonly string[];
  preview?: readonly string[];
  allowed?: readonly string[];
} = {}) {
  vi.doMock('@/utils/cip113Deployments', () => ({
    CIP113_BASE_MAINNET: deployments.mainnet ?? [],
    CIP113_BASE_PREPROD: deployments.preprod ?? [],
    CIP113_BASE_PREVIEW: deployments.preview ?? [],
    // Defaulted WIDE on purpose: the hash parsing/normalization cases below run through
    // preprod and are not about the allowlist. The value actually shipped is pinned by
    // its own test against the real module.
    CIP113_ALLOWED_NETWORKS: deployments.allowed ?? [Network.MAINNET, Network.PREPROD, Network.PREVIEW],
  }));
  const mod = await import('./networks');
  return mod.default;
}

describe('networks — CIP-113 programmable token configuration', () => {
  beforeEach(() => {
    vi.doUnmock('@/utils/cip113Deployments');
    vi.resetModules();
  });

  it('exposes a configured base script hash and derives support from it', async () => {
    const networks = await loadNetworks({ preprod: [VALID_PREPROD] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([VALID_PREPROD]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(true);
  });

  it('treats an empty deployment list as unsupported', async () => {
    const networks = await loadNetworks();

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('treats an entry that is an empty string the same as no entry at all', async () => {
    const networks = await loadNetworks({ preprod: [''] });

    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  // The configured hash is taken as granted — no on-chain check, no allowlist —
  // so the format check is the only guard against a mis-pasted trust anchor.
  // Each of these must fail closed rather than become a wrong base script.
  it.each([
    ['too short', VALID_PREPROD.slice(0, 40)],
    ['too long', `${VALID_PREPROD}ab`],
    ['0x-prefixed', `0x${VALID_PREPROD}`],
    ['bech32 address', 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'],
    ['non-hex characters', 'z'.repeat(56)],
  ])('rejects a malformed hash (%s) as unconfigured', async (_label, value) => {
    const networks = await loadNetworks({ preprod: [value] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('normalizes surrounding whitespace and uppercase hex', async () => {
    const networks = await loadNetworks({ preprod: [`  ${VALID_PREPROD.toUpperCase()}  `] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD)).toEqual([VALID_PREPROD]);
  });

  it('keeps networks independent — configuring preprod does not enable mainnet', async () => {
    const networks = await loadNetworks({ preprod: [VALID_PREPROD] });

    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.MAINNET)).toBe(false);
    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
  });

  it('de-duplicates a repeated hash across a rotation list', async () => {
    const older = '8adfe689f4049706f893745f9e8af24cc2cade650de9bac05e3d403f';
    const networks = await loadNetworks({ preprod: [VALID_PREPROD, older, VALID_PREPROD] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD))
      .toEqual([VALID_PREPROD, older]);
  });

  it('reports unsupported for non-Cardano chains and for missing arguments', async () => {
    const networks = await loadNetworks({ preprod: [VALID_PREPROD] });

    expect(networks.resolveProgrammableTokenSupport(Blockchain.BITCOIN, Network.TESTNET)).toBe(false);
    expect(networks.resolveProgrammableTokenSupport('', '')).toBe(false);
    expect(networks.resolveProgrammableLogicBaseScriptHashes('', '')).toEqual([]);
  });
});

// Pins what actually ships, against the real module. A hash here is a trust anchor (see
// cip113Deployments.ts), so changing one has to be a deliberate edit to this test too.
describe('CIP-113 shipped deployment lists', () => {
  beforeEach(() => {
    vi.doUnmock('@/utils/cip113Deployments');
    vi.resetModules();
  });

  it('ships exactly the current deployment on each network', async () => {
    const deployments = await import('@/utils/cip113Deployments');

    expect([...deployments.CIP113_BASE_MAINNET]).toEqual(['d91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838']);
    expect([...deployments.CIP113_BASE_PREPROD]).toEqual(['be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3']);
    expect([...deployments.CIP113_BASE_PREVIEW]).toEqual(['35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16']);
  });

  it('resolves the shipped deployment on each network', async () => {
    const networks = (await import('./networks')).default;

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.MAINNET))
      .toEqual(['d91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838']);
    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREPROD))
      .toEqual(['be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3']);
    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREVIEW))
      .toEqual(['35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16']);
  });

  // Superseded testnet deployments are removed, not retained — see cip113Deployments.ts.
  it.each([
    [Network.PREPROD, 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d'],
    [Network.PREVIEW, '698c48a630206282690774aebcfa9410895c09f85bc103b19f9888dc'],
    [Network.PREVIEW, '33ceea92481cd6cc5b9ad1750302642042bb8ea5d028b830ad86fc31'],
    [Network.PREVIEW, '8adfe689f4049706f893745f9e8af24cc2cade650de9bac05e3d403f'],
    [Network.PREVIEW, 'f2182b00a37bd746e20575c9af01ab31312213514cd31e872e0a2a3e'],
  ])('does not recognise the removed %s deployment %s', async (network, removed) => {
    const networks = (await import('./networks')).default;

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, network)).not.toContain(removed);
  });
});

describe('cip68Label — CIP-67 prefix decoding', () => {
  it('identifies each CIP-67 label', async () => {
    const { cip68Label } = await import('@/shared/utils/resolver');
    const name = '54657374313233'; // "Test123"
    expect(cip68Label(`000643b0${name}`)).toBe(100); // reference token — filtered from holdings
    expect(cip68Label(`000de140${name}`)).toBe(222); // NFT
    expect(cip68Label(`0014df10${name}`)).toBe(333); // FT
  });

  it('returns null for an unlabelled asset name and for a bad checksum', async () => {
    const { cip68Label } = await import('@/shared/utils/resolver');
    expect(cip68Label('54657374313233')).toBeNull();
    expect(cip68Label('000643ff54657374313233')).toBeNull();
    expect(cip68Label('')).toBeNull();
    expect(cip68Label(undefined)).toBeNull();
  });
});

// The network allowlist is a second gate, independent of the hash lists. It stops
// recording a newly-deployed hash from bringing a network live by itself.
describe('networks — CIP-113 network allowlist', () => {
  beforeEach(() => {
    vi.doUnmock('@/utils/cip113Deployments');
    vi.resetModules();
  });

  it('refuses a network that is not allowlisted, even with a valid hash configured', async () => {
    const networks = await loadNetworks({ mainnet: [VALID_PREPROD], allowed: [Network.PREVIEW] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.MAINNET)).toBe(false);
  });

  it('still resolves a network that is allowlisted', async () => {
    const networks = await loadNetworks({ preview: [VALID_PREPROD], allowed: [Network.PREVIEW] });

    expect(networks.resolveProgrammableLogicBaseScriptHashes(Blockchain.CARDANO, Network.PREVIEW)).toEqual([VALID_PREPROD]);
    expect(networks.resolveProgrammableTokenSupport(Blockchain.CARDANO, Network.PREVIEW)).toBe(true);
  });

  // Pins what actually ships. Changing this is the deliberate act of enabling (or
  // disabling) CIP-113 on a network, and should not pass review as a drive-by edit.
  it('ships allowing mainnet, preprod and preview', async () => {
    const { CIP113_ALLOWED_NETWORKS } = await import('./cip113Deployments');

    expect([...CIP113_ALLOWED_NETWORKS]).toEqual([Network.MAINNET, Network.PREPROD, Network.PREVIEW]);
  });
});
