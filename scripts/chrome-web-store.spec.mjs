import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
// The test config resolves node:crypto to a browser polyfill. The workflow runs this
// script on Node itself, so test it against Node's own crypto.
vi.mock('node:crypto', async () => (await import('node:module')).createRequire(import.meta.url)('node:crypto'));
const { createVerify, generateKeyPairSync } = createRequire(import.meta.url)('node:crypto');
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extensionIdForKey, inspectReleaseArtifact } from './check-release-artifact.mjs';
import {
  API_ROOT, SCOPE, TOKEN_URI, accessToken, checkBeforeUpload, compareVersions, extensionIdForPublicKey,
  releaseToStore, storeClient, verifyStoreCandidate,
} from './chrome-web-store.mjs';

const KEY = Buffer.from('synthetic-public-manifest-key').toString('base64');
const ITEM = extensionIdForKey(KEY);
const PEM = `-----BEGIN PUBLIC KEY-----\n${KEY.match(/.{1,16}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
const TOKEN = 'ya29.synthetic-access-token';

const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

/** A fake store: records every request and answers from per-endpoint queues. */
function fakeStore({ status = {}, upload = { uploadState: 'SUCCEEDED', crxVersion: '2.8.0' }, publish = { state: 'PENDING_REVIEW' }, polls = [] } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith(':fetchStatus')) return reply(200, polls.length ? polls.shift() : status);
    if (url.endsWith(':upload')) return reply(200, upload);
    if (url.endsWith(':publish')) return reply(200, publish);
    return reply(404, { error: { message: 'unexpected endpoint' } });
  });
  return { calls, client: storeClient({ publisherId: 'publisher-1', itemId: ITEM, token: TOKEN, fetch }) };
}

describe('compareVersions', () => {
  it('orders Chrome versions numerically, missing parts as zero', () => {
    expect(compareVersions('2.8.0', '2.7.2')).toBe(1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(compareVersions('2.8', '2.8.0.0')).toBe(0);
    expect(compareVersions('2.7.2', '2.8.0')).toBe(-1);
  });
});

describe('extensionIdForPublicKey', () => {
  it('accepts the store key as PEM or bare base64', () => {
    expect(extensionIdForPublicKey(PEM)).toBe(ITEM);
    expect(extensionIdForPublicKey(KEY)).toBe(ITEM);
  });
});

describe('accessToken', () => {
  it('exchanges a refresh token', async () => {
    const fetch = vi.fn(async () => reply(200, { access_token: TOKEN }));
    expect(await accessToken({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }, { fetch })).toBe(TOKEN);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(TOKEN_URI);
    expect(Object.fromEntries(init.body)).toEqual({ grant_type: 'refresh_token', client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' });
  });

  it('signs a service account assertion for the store scope', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = { client_email: 'release@gero.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const fetch = vi.fn(async () => reply(200, { access_token: TOKEN }));
    await accessToken({ serviceAccountJson: JSON.stringify(account) }, { fetch, now: () => 1_700_000_000_000 });

    const form = Object.fromEntries(fetch.mock.calls[0][1].body);
    expect(form.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.assertion.split('.');
    expect(JSON.parse(Buffer.from(claims.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())).toEqual({
      iss: account.client_email, scope: SCOPE, aud: TOKEN_URI, iat: 1_700_000_000, exp: 1_700_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')).toBe(true);
  });

  it('names the failure without echoing the credentials', async () => {
    const fetch = vi.fn(async () => reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    const failure = accessToken({ clientId: 'id', clientSecret: 'top-secret', refreshToken: 'refresh-secret' }, { fetch });
    await expect(failure).rejects.toThrow('HTTP 400 (invalid_grant: Token has been expired or revoked.)');
    await failure.catch(error => {
      expect(error.message).not.toContain('top-secret');
      expect(error.message).not.toContain('refresh-secret');
    });
  });

  it('refuses incomplete credentials before calling Google', async () => {
    const fetch = vi.fn();
    await expect(accessToken({ clientId: 'id', refreshToken: 'refresh' }, { fetch })).rejects.toThrow('CWS_CLIENT_SECRET');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('storeClient', () => {
  it.each([
    ['a publisher ID that changes the path', { publisherId: '../other', itemId: ITEM }],
    ['an item ID that is not an extension ID', { publisherId: 'publisher-1', itemId: 'not-an-id' }],
  ])('rejects %s', (_name, ids) => {
    expect(() => storeClient({ ...ids, token: TOKEN, fetch: vi.fn() })).toThrow();
  });

  it('reports the store error without the access token', async () => {
    const fetch = vi.fn(async () => reply(403, { error: { message: 'The caller does not have permission' } }));
    const failure = storeClient({ publisherId: 'publisher-1', itemId: ITEM, token: TOKEN, fetch }).status();
    await expect(failure).rejects.toThrow('Chrome Web Store status check failed: HTTP 403: The caller does not have permission');
    await failure.catch(error => expect(error.message).not.toContain(TOKEN));
  });
});

describe('checkBeforeUpload', () => {
  const version = '2.8.0';
  const published = crxVersion => ({ publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion, deployPercentage: 100 }] } });

  it('passes a newer version over a published item whose key is ours', () => {
    expect(checkBeforeUpload({ publicKey: PEM, ...published('2.7.2') }, { itemId: ITEM, version })).toEqual([]);
  });

  it.each([
    ['a taken-down item', { takenDown: true }, 'taken this item down'],
    ["another extension's key", { publicKey: Buffer.from('other-key').toString('base64') }, 'public key'],
    ['a version already in review', { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }, 'in review'],
    ['an approved version waiting to be published', { submittedItemRevisionStatus: { state: 'STAGED' } }, 'waiting to be published'],
    ['the same version already published', published('2.8.0'), 'must be higher'],
    ['a newer version already published', published('2.9.0'), 'must be higher'],
  ])('refuses %s', (_name, status, reason) => {
    expect(checkBeforeUpload(status, { itemId: ITEM, version }).join('\n')).toContain(reason);
  });
});

describe('releaseToStore', () => {
  const zip = Buffer.from('PK synthetic zip');
  const release = (client, overrides = {}) => releaseToStore({
    client, zip, itemId: ITEM, version: '2.8.0', submission: 'staged', sleep: async () => {}, ...overrides,
  });

  it('uploads the exact bytes, then submits for a staged publish', async () => {
    const { calls, client } = fakeStore({ publish: { state: 'PENDING_REVIEW' } });
    const result = await release(client);

    expect(calls.map(call => call.url)).toEqual([
      `${API_ROOT}/v2/publishers/publisher-1/items/${ITEM}:fetchStatus`,
      `${API_ROOT}/upload/v2/publishers/publisher-1/items/${ITEM}:upload`,
      `${API_ROOT}/v2/publishers/publisher-1/items/${ITEM}:publish`,
      `${API_ROOT}/v2/publishers/publisher-1/items/${ITEM}:fetchStatus`,
    ]);
    expect(calls[1].body).toBe(zip);
    expect(calls[1].headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'X-Goog-Upload-Protocol': 'raw' });
    expect(JSON.parse(calls[2].body)).toEqual({ publishType: 'STAGED_PUBLISH' });
    expect(result).toMatchObject({ submission: 'staged', upload: { uploadState: 'SUCCEEDED', crxVersion: '2.8.0' }, submissionState: 'PENDING_REVIEW' });
  });

  it('publishes on approval, to a percentage when one is given', async () => {
    const { calls, client } = fakeStore();
    await release(client, { submission: 'publish', deployPercentage: 10 });
    expect(JSON.parse(calls[2].body)).toEqual({ publishType: 'DEFAULT_PUBLISH', deployInfos: [{ deployPercentage: 10 }] });
  });

  it('leaves an upload-only release as a draft', async () => {
    const { calls, client } = fakeStore();
    const result = await release(client, { submission: 'upload-only' });
    expect(calls.some(call => call.url.endsWith(':publish'))).toBe(false);
    expect(result.submissionState).toBeNull();
  });

  it('waits for an upload the store is still processing', async () => {
    const { calls, client } = fakeStore({
      upload: { uploadState: 'IN_PROGRESS', crxVersion: '2.8.0' },
      polls: [{}, { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' }],
    });
    const result = await release(client);
    expect(result.upload.uploadState).toBe('SUCCEEDED');
    expect(calls.filter(call => call.url.endsWith(':publish'))).toHaveLength(1);
  });

  it('gives up on an upload that never finishes, without submitting', async () => {
    const { calls, client } = fakeStore({ upload: { uploadState: 'IN_PROGRESS' }, status: { lastAsyncUploadState: 'IN_PROGRESS' } });
    await expect(release(client, { pollMs: 1, timeoutMs: 3 })).rejects.toThrow('still processing');
    expect(calls.some(call => call.url.endsWith(':publish'))).toBe(false);
  });

  it.each([
    ['a failed upload', { uploadState: 'FAILED' }, 'did not accept the upload (FAILED)'],
    ['a package the store reads as another version', { uploadState: 'SUCCEEDED', crxVersion: '2.7.9' }, 'read version 2.7.9'],
  ])('stops at %s', async (_name, upload, reason) => {
    const { calls, client } = fakeStore({ upload });
    await expect(release(client)).rejects.toThrow(reason);
    expect(calls.some(call => call.url.endsWith(':publish'))).toBe(false);
  });

  it('uploads nothing when the item is not ready for this version', async () => {
    const { calls, client } = fakeStore({ status: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } } });
    await expect(release(client)).rejects.toThrow('in review');
    expect(calls).toHaveLength(1);
  });
});

describe('verifyStoreCandidate', () => {
  let root;
  const SHA = 'a'.repeat(40);
  const LOCK = 'b'.repeat(64);
  const write = (base, name, contents) => { mkdirSync(dirname(join(base, name)), { recursive: true }); writeFileSync(join(base, name), contents); };
  const extension = () => join(root, 'candidate', 'extension');
  const unzipped = () => join(root, 'unzipped');
  const record = changes => {
    const report = inspectReleaseArtifact(extension(), { expectedVersion: '2.8.0', expectedId: ITEM });
    write(join(root, 'candidate'), 'release-evidence/artifact.json', JSON.stringify({
      ...report, packageLockSha256: LOCK, sourceSha: SHA, channel: 'production', ...changes,
    }));
  };
  const verify = overrides => verifyStoreCandidate({
    candidateDir: join(root, 'candidate'), unzippedDir: unzipped(), version: '2.8.0', channel: 'production',
    sourceSha: SHA, packageLockSha256: LOCK, ...overrides,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gero-store-'));
    write(extension(), 'manifest.json', JSON.stringify({
      manifest_version: 3, version: '2.8.0', key: KEY,
      background: { service_worker: 'background/index.js' },
      options_page: 'index.html', side_panel: { default_path: 'sidepanel/index.html' },
      content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none';" },
    }));
    write(extension(), 'background/index.js', 'export {};');
    write(extension(), 'assets/crypto.wasm', Buffer.from([0, 97, 115, 109]));
    write(extension(), 'index.html', '<p>dashboard</p>');
    write(extension(), 'sidepanel/index.html', '<p>side panel</p>');
    record();
    cpSync(extension(), unzipped(), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts the tested package and reports its extension ID', () => {
    expect(verify()).toEqual({ ok: true, problems: [], extensionId: ITEM });
  });

  it.each([
    ['another version', { version: '2.8.1' }],
    ['another channel', { channel: 'beta' }],
    ['another commit', { sourceSha: 'c'.repeat(40) }],
    ['another lockfile', { packageLockSha256: 'd'.repeat(64) }],
  ])('rejects a package tested for %s', (_name, overrides) => {
    expect(verify(overrides).ok).toBe(false);
  });

  it('rejects a package whose identity the release run did not verify', () => {
    record({ identityVerified: false });
    expect(verify().problems.join('\n')).toContain('extension identity');
  });

  it('rejects a file changed in the extension directory after testing', () => {
    write(extension(), 'background/index.js', 'export const changed = true;');
    expect(verify().problems.join('\n')).toContain('extension directory does not hold exactly');
  });

  it('rejects a ZIP that does not hold the tested files', () => {
    write(unzipped(), 'assets/extra.js', 'export {};');
    expect(verify().problems.join('\n')).toContain('ZIP does not hold exactly');
  });
});
