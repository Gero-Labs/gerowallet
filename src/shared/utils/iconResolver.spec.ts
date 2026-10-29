import { afterEach, describe, expect, it, vi } from 'vitest';

const BACKEND = 'https://api.gerowallet.io';
const placeholders = {
  greenSvg: 'g', yellowSvg: 'y', purpleSvg: 'p', pinkSvg: 'pk', orangeSvg: 'o', blueSvg: 'b', greySvg: 'gr', errorImage: 'err',
};

async function load(backendUrl: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_BACKEND_URL', backendUrl as string);
  return import('./iconResolver');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('metadata images', () => {
  it('fetches an issuer-hosted https image through the image proxy', async () => {
    const { resolveIconUrl } = await load(BACKEND);
    const image = 'https://tracker.example/pixel.png?wallet=1';
    expect(resolveIconUrl(image, placeholders)).toBe(`${BACKEND}/api/img?url=${encodeURIComponent(image)}`);
  });

  it('fetches Gero\'s own hosts directly', async () => {
    const { resolveIconUrl } = await load(BACKEND);
    for (const url of ['https://api.gerowallet.io/api/ar/x', 'https://assets.gerowallet.io/a.png', 'https://gerowallet.io/logo.png']) {
      expect(resolveIconUrl(url, placeholders)).toBe(url);
    }
    expect(resolveIconUrl('https://gerowallet.io.evil.example/a.png', placeholders)).toContain('/api/img?url=');
  });

  it('keeps IPFS, Arweave and data images on their existing paths', async () => {
    const { resolveIconUrl } = await load(BACKEND);
    expect(resolveIconUrl('ipfs://QmV7xw3QtGgqWR3PXtJSJdFKkW4ZhELmBwJS6edhVyKFVL', placeholders)).toContain('/api/ipfs?path=');
    expect(resolveIconUrl('https://ipfs.io/ipfs/QmV7xw3QtGgqWR3PXtJSJdFKkW4ZhELmBwJS6edhVyKFVL', placeholders)).toContain('/api/ipfs?path=');
    expect(resolveIconUrl('ar://abc', placeholders)).toBe(`${BACKEND}/api/ar/abc`);
    expect(resolveIconUrl('data:image/png;base64,AAAA', placeholders)).toBe('data:image/png;base64,AAAA');
  });

  it('leaves plain http alone (the extension CSP blocks it) and works without a backend URL', async () => {
    const withBackend = await load(BACKEND);
    expect(withBackend.proxiedImageUrl('http://tracker.example/p.png')).toBe('http://tracker.example/p.png');
    const without = await load('');
    expect(without.proxiedImageUrl('https://tracker.example/p.png')).toBe('https://tracker.example/p.png');
  });
});

describe('third-party images (pool icons, DRep avatars)', () => {
  it('fetches an https image through the image proxy and Gero\'s own hosts directly', async () => {
    const { thirdPartyImageUrl } = await load(BACKEND);
    const icon = 'https://pool.example/icon.png';
    expect(thirdPartyImageUrl(icon)).toBe(`${BACKEND}/api/img?url=${encodeURIComponent(icon)}`);
    expect(thirdPartyImageUrl(' https://pool.example/icon.png ')).toBe(`${BACKEND}/api/img?url=${encodeURIComponent(icon)}`);
    expect(thirdPartyImageUrl('https://assets.gerowallet.io/a.png')).toBe('https://assets.gerowallet.io/a.png');
  });

  it('maps IPFS onto the IPFS proxy', async () => {
    const { thirdPartyImageUrl } = await load(BACKEND);
    const cid = 'QmV7xw3QtGgqWR3PXtJSJdFKkW4ZhELmBwJS6edhVyKFVL';
    expect(thirdPartyImageUrl(`ipfs://${cid}`)).toContain('/api/ipfs?path=');
    expect(thirdPartyImageUrl(`ipfs://ipfs/${cid}/a.png`)).toContain('/api/ipfs?path=');
    expect(thirdPartyImageUrl(`https://ipfs.io/ipfs/${cid}`)).toContain('/api/ipfs?path=');
    expect(thirdPartyImageUrl('ipfs://not-a-cid')).toBeNull();
  });

  it('drops everything else: plain http, placeholders, other schemes, nothing', async () => {
    const { thirdPartyImageUrl } = await load(BACKEND);
    for (const bad of ['http://pool.example/icon.png', 'http(s) url to pool icon; ...', 'javascript:alert(1)',
      'data:image/png;base64,AAAA', 'ftp://x/a.png', 'https://two words.example/a.png', '', '   ', undefined, null, 42]) {
      expect(thirdPartyImageUrl(bad)).toBeNull();
    }
  });
});

