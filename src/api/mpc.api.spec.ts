import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosInstance } from 'axios';
import { Api } from './api';

function makeApi() {
  // Object.create(Api.prototype) would skip the constructor and leave class
  // fields like `mpc`/`multiSig` undefined, so construct for real and then
  // swap in a mocked axiosInstance (mirrors how other Api members are tested).
  const api = new Api(undefined, undefined);
  const post = vi.fn();
  api.axiosInstance = { post } as unknown as AxiosInstance;
  return { api, post };
}

describe('Api.mpc', () => {
  let api: Api;
  let post: ReturnType<typeof vi.fn>;
  beforeEach(() => { ({ api, post } = makeApi()); });

  it('enroll posts the Plan B contract body and returns result', async () => {
    post.mockResolvedValue({ data: { stored: true }, status: 200 });
    const res = await api.mpc.enroll('idtok', 'cardano', 'mainnet', 'gmpc1.02.X.Y');
    expect(post).toHaveBeenCalledWith('/api/mpc/enroll', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet', loginShare: 'gmpc1.02.X.Y',
    });
    expect(res).toEqual({ stored: true });
  });

  it('getLoginShare posts idToken+chain+network and returns the share string', async () => {
    post.mockResolvedValue({ data: { loginShare: 'gmpc1.02.X.Y' }, status: 200 });
    const share = await api.mpc.getLoginShare('idtok', 'cardano', 'mainnet');
    expect(post).toHaveBeenCalledWith('/api/mpc/login-share', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(share).toBe('gmpc1.02.X.Y');
  });

  it('storeRecovery posts the exact recovery-store body and returns result', async () => {
    post.mockResolvedValue({ data: { stored: true }, status: 200 });
    const res = await api.mpc.storeRecovery('idtok', 'cardano', 'mainnet', 'encblob', 'xpubanchor');
    expect(post).toHaveBeenCalledWith('/api/mpc/recovery/store', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
      encryptedRecovery: 'encblob', publicKey: 'xpubanchor',
    });
    expect(res).toEqual({ stored: true });
  });

  it('fetchRecovery posts idToken+chain+network and returns blob+publicKey', async () => {
    post.mockResolvedValue({ data: { encryptedRecovery: 'encblob', publicKey: 'xpubanchor' }, status: 200 });
    const res = await api.mpc.fetchRecovery('idtok', 'cardano', 'mainnet');
    expect(post).toHaveBeenCalledWith('/api/mpc/recovery/fetch', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(res).toEqual({ encryptedRecovery: 'encblob', publicKey: 'xpubanchor' });
  });

  it('rotate posts idToken+chain+network+loginShare and returns result', async () => {
    post.mockResolvedValue({ data: { rotated: true }, status: 200 });
    const res = await api.mpc.rotate('idtok', 'cardano', 'mainnet', 'gmpc1.02.NEW');
    expect(post).toHaveBeenCalledWith('/api/mpc/rotate', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet', loginShare: 'gmpc1.02.NEW',
    });
    expect(res).toEqual({ rotated: true });
  });

  it('deregister posts idToken+chain+network and returns result', async () => {
    post.mockResolvedValue({ data: { deregistered: true }, status: 200 });
    const res = await api.mpc.deregister('idtok', 'cardano', 'mainnet');
    expect(post).toHaveBeenCalledWith('/api/mpc/deregister', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(res).toEqual({ deregistered: true });
  });

  it('deregister rejects via parseHttpError on a non-200 status', async () => {
    post.mockResolvedValue({ data: { message: 'not found' }, status: 404 });
    await expect(api.mpc.deregister('idtok', 'cardano', 'mainnet')).rejects.toBeDefined();
  });
});
