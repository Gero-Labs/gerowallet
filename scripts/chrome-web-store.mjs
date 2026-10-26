/**
 * Chrome Web Store release steps for .github/workflows/chrome-web-store.yml.
 *
 *   verify   re-checks the package that "Chrome Extension CI/CD" built and tested earlier
 *            in the same run, and that its ZIP holds exactly the files that were tested.
 *   e2e-gate checks a gerowallet-e2e-tests qualification report for that ZIP.
 *   release  uploads that ZIP through the Chrome Web Store API v2 and, if asked, submits
 *            it for review. (v1.1 stopped being supported on October 15, 2026.)
 *
 * Neither step builds, edits or repacks anything: the bytes uploaded are the bytes the
 * release run tested. Only Node built-ins are used, so the job that holds the store
 * credentials installs no packages. See .github/runbooks/chrome-web-store.md.
 */
import { createSign } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionIdForKey, inspectReleaseArtifact } from './check-release-artifact.mjs';

export const API_ROOT = 'https://chromewebstore.googleapis.com';
export const TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
/** What each `submission` choice asks the store to do once the upload succeeds. */
export const PUBLISH_TYPES = { 'upload-only': null, staged: 'STAGED_PUBLISH', publish: 'DEFAULT_PUBLISH' };
/** Submission states in which the store already holds another version in its queue. */
const BUSY_STATES = new Set(['PENDING_REVIEW', 'STAGED']);
const VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/;

const base64url = value => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

/** Compare two Chrome extension versions (up to four dot-separated integers). */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map(version => String(version).split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** The extension ID a store public key belongs to, whether it comes as PEM or bare base64. */
export function extensionIdForPublicKey(publicKey) {
  return extensionIdForKey(String(publicKey).replace(/-----(?:BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''));
}

/**
 * Re-check the tested package before it goes anywhere near the store.
 *
 * `candidateDir` is the release run's artifact (extension/ and release-evidence/);
 * `unzippedDir` is its ZIP, extracted. Both trees must pass the release gate again and
 * hash to the checksums the release run recorded, so the ZIP is the tested tree.
 */
export function verifyStoreCandidate({ candidateDir, unzippedDir, version, channel, sourceSha, packageLockSha256 }) {
  const recorded = JSON.parse(readFileSync(join(candidateDir, 'release-evidence', 'artifact.json'), 'utf8'));
  const problems = [];
  if (recorded.ok !== true) problems.push('The release run did not record a passing artifact report');
  if (recorded.identityVerified !== true || !/^[a-p]{32}$/.test(recorded.extensionId ?? '')) problems.push('The release run did not verify the extension identity');
  if (recorded.version !== version) problems.push(`The tested package is ${recorded.version}, not ${version}`);
  if (recorded.channel !== channel) problems.push(`The tested package was built for the ${recorded.channel} channel, not ${channel}`);
  if (recorded.sourceSha !== sourceSha) problems.push('The tested package was not built from the commit being released');
  if (recorded.packageLockSha256 !== packageLockSha256) problems.push('The tested package was built from a different package-lock.json than the commit being released');
  const options = { expectedVersion: version, expectedId: recorded.extensionId };
  const checksums = JSON.stringify(recorded.checksums ?? {});
  for (const [label, directory] of [['extension directory', join(candidateDir, 'extension')], ['ZIP', unzippedDir]]) {
    const report = inspectReleaseArtifact(directory, options);
    for (const problem of report.problems) problems.push(`${label}: ${problem}`);
    if (JSON.stringify(report.checksums) !== checksums) problems.push(`The ${label} does not hold exactly the files the release run tested`);
  }
  return { ok: problems.length === 0, problems, extensionId: recorded.extensionId ?? null };
}

/**
 * Reasons an e2e suite's qualification.json does not clear the release.
 *
 * The report comes from gerowallet-e2e-tests' qualification reporter. It must be about this
 * wallet commit and this ZIP, must have run tests, and must have no failures. A test that
 * passed only on retry also blocks: the harness counts it as incomplete qualification.
 * Skips are allowed (each carries a reason and a category in the report).
 */
export function checkE2eQualification(report, { walletSha, archiveSha256 }) {
  const problems = [];
  const counts = report.counts ?? {};
  if (report.walletSha !== walletSha) problems.push('The e2e report is about another wallet commit');
  if (report.releaseArchiveSha256 !== archiveSha256) problems.push('The e2e report is about another release ZIP');
  if (!Array.isArray(report.tests) || report.tests.length === 0) problems.push('The e2e suite ran no tests');
  for (const status of ['failed', 'timedOut', 'interrupted']) {
    if (counts[status]) problems.push(`${counts[status]} e2e test(s) ${status === 'timedOut' ? 'timed out' : status}`);
  }
  if (counts.flaky) problems.push(`${counts.flaky} e2e test(s) passed only on retry`);
  if (report.status !== 'passed' && problems.length === 0) problems.push(`The e2e suite ended as "${report.status}"`);
  return problems;
}

/** An OAuth access token for the store API: from a service account if one is set, else a refresh token. */
export async function accessToken(credentials, { fetch = globalThis.fetch, now = Date.now } = {}) {
  let body;
  if (credentials.serviceAccountJson) {
    const account = JSON.parse(credentials.serviceAccountJson);
    if (!account.client_email || !account.private_key) throw new Error('The service account JSON needs client_email and private_key');
    const issuedAt = Math.floor(now() / 1000);
    const claims = { iss: account.client_email, scope: SCOPE, aud: TOKEN_URI, iat: issuedAt, exp: issuedAt + 3600 };
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
    const signature = base64url(createSign('RSA-SHA256').update(unsigned).sign(account.private_key));
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` });
  } else {
    const { clientId, clientSecret, refreshToken } = credentials;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Set CWS_SERVICE_ACCOUNT_JSON, or all of CWS_CLIENT_ID, CWS_CLIENT_SECRET and CWS_REFRESH_TOKEN');
    }
    body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  }
  const response = await fetch(TOKEN_URI, { method: 'POST', body });
  const json = await readJson(response);
  if (!response.ok || typeof json.access_token !== 'string') {
    // Google's error codes (invalid_grant, …) name the problem without echoing credentials.
    const reason = [json.error, json.error_description].filter(value => typeof value === 'string').join(': ');
    throw new Error(`Could not get a Chrome Web Store access token: HTTP ${response.status}${reason ? ` (${reason})` : ''}`);
  }
  return json.access_token;
}

/** The three store API v2 calls a release needs, for one item. */
export function storeClient({ publisherId, itemId, token, fetch = globalThis.fetch }) {
  if (!/^[A-Za-z0-9._-]+$/.test(publisherId ?? '')) throw new Error('CWS_PUBLISHER_ID is missing or malformed');
  if (!/^[a-p]{32}$/.test(itemId ?? '')) throw new Error('CWS_ITEM_ID must be a 32-letter Chrome extension ID');
  const item = `publishers/${publisherId}/items/${itemId}`;
  const call = async (what, url, init) => {
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    const json = await readJson(response);
    if (!response.ok) {
      const message = typeof json.error?.message === 'string' ? `: ${json.error.message}` : '';
      throw new Error(`Chrome Web Store ${what} failed: HTTP ${response.status}${message}`);
    }
    return json;
  };
  return {
    status: () => call('status check', `${API_ROOT}/v2/${item}:fetchStatus`, { method: 'GET' }),
    upload: zip => call('upload', `${API_ROOT}/upload/v2/${item}:upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': 'extension.zip' },
      body: zip,
    }),
    publish: (publishType, deployPercentage) => call('submission', `${API_ROOT}/v2/${item}:publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishType, ...(deployPercentage ? { deployInfos: [{ deployPercentage }] } : {}) }),
    }),
  };
}

const revision = status => (status ? {
  state: status.state ?? null,
  channels: (status.distributionChannels ?? []).map(channel => ({ crxVersion: channel.crxVersion ?? null, deployPercentage: channel.deployPercentage ?? null })),
} : null);

/** The parts of a fetchStatus answer worth keeping as evidence. */
export function summarizeStatus(status) {
  return {
    takenDown: status.takenDown === true,
    lastAsyncUploadState: status.lastAsyncUploadState ?? null,
    published: revision(status.publishedItemRevisionStatus),
    submitted: revision(status.submittedItemRevisionStatus),
  };
}

/** Reasons not to upload `version` over the store item's current state. */
export function checkBeforeUpload(status, { itemId, version }) {
  const problems = [];
  if (status.takenDown) problems.push('The store has taken this item down; resolve that in the Developer Dashboard first');
  if (status.publicKey) {
    let storeId = null;
    try { storeId = extensionIdForPublicKey(status.publicKey); } catch { /* reported below */ }
    if (storeId !== itemId) problems.push("The store item's public key does not belong to this extension ID");
  }
  const submitted = status.submittedItemRevisionStatus?.state;
  if (BUSY_STATES.has(submitted)) {
    problems.push(`Another version is already ${submitted === 'STAGED' ? 'approved and waiting to be published' : 'in review'}; publish or cancel it in the Developer Dashboard first`);
  }
  for (const channel of status.publishedItemRevisionStatus?.distributionChannels ?? []) {
    if (channel.crxVersion && compareVersions(channel.crxVersion, version) >= 0) {
      problems.push(`The store already serves ${channel.crxVersion}; ${version} must be higher`);
    }
  }
  return problems;
}

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** Upload the ZIP and wait until the store has finished reading it. */
export async function uploadPackage(client, zip, { version, sleep = wait, pollMs = 5000, timeoutMs = 10 * 60_000 }) {
  const uploaded = await client.upload(zip);
  if (uploaded.crxVersion && uploaded.crxVersion !== version) {
    throw new Error(`The store read version ${uploaded.crxVersion} from the package, not ${version}`);
  }
  let state = uploaded.uploadState;
  for (let waited = 0; state === 'IN_PROGRESS'; waited += pollMs) {
    if (waited >= timeoutMs) throw new Error('The store is still processing the upload; check the Developer Dashboard before running this again');
    await sleep(pollMs);
    state = (await client.status()).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`The store did not accept the upload (${state ?? 'no upload state'})`);
  return { uploadState: state, crxVersion: uploaded.crxVersion ?? null };
}

/** Check the item, upload the ZIP, then submit it as `submission` asks. */
export async function releaseToStore({ client, zip, itemId, version, submission, deployPercentage, ...timing }) {
  if (!Object.hasOwn(PUBLISH_TYPES, submission)) throw new Error(`Unknown submission "${submission}"`);
  const before = await client.status();
  const problems = checkBeforeUpload(before, { itemId, version });
  if (problems.length) throw new Error(problems.join('\n'));
  const upload = await uploadPackage(client, zip, { version, ...timing });
  const publishType = PUBLISH_TYPES[submission];
  const submitted = publishType ? await client.publish(publishType, deployPercentage) : null;
  const after = await client.status();
  return {
    itemId,
    version,
    submission,
    upload,
    submissionState: submitted?.state ?? null,
    before: summarizeStatus(before),
    after: summarizeStatus(after),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--')) throw new Error(`Unexpected argument ${rest[i]}`);
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, options };
}

function percentage(value) {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error('--deploy-percentage must be a whole number from 1 to 100');
  return number;
}

async function main({ command, options }, env) {
  if (command === 'e2e-gate') {
    const report = JSON.parse(readFileSync(options.qualification, 'utf8'));
    const problems = checkE2eQualification(report, { walletSha: options['wallet-sha'], archiveSha256: options['archive-sha256'] });
    if (problems.length) throw new Error(problems.join('\n'));
    const { passed = 0, skipped = 0 } = report.counts ?? {};
    return `${passed} passed, ${skipped} skipped, none failed or passed only on retry`;
  }
  if (command !== 'verify' && command !== 'release') throw new Error('Usage: chrome-web-store.mjs verify|e2e-gate|release …');
  if (!VERSION.test(options.version ?? '')) throw new Error('--version must be a Chrome extension version such as 2.8.0');
  if (command === 'verify') {
    const result = verifyStoreCandidate({
      candidateDir: options.candidate,
      unzippedDir: options.unzipped,
      version: options.version,
      channel: options.channel,
      sourceSha: options['source-sha'],
      packageLockSha256: options['lock-sha256'],
    });
    if (!result.ok) throw new Error(result.problems.join('\n'));
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `extension_id=${result.extensionId}\n`);
    return `package ${options.version} for ${result.extensionId} matches what was tested`;
  }
  if (options['expected-id'] !== env.CWS_ITEM_ID) throw new Error("CWS_ITEM_ID is not the extension ID the tested package was built for; check this channel's environment");
  const deployPercentage = percentage(options['deploy-percentage']);
  if (deployPercentage && options.submission === 'upload-only') throw new Error('A rollout percentage needs a submission');
  const zip = readFileSync(options.zip);
  const token = await accessToken({
    serviceAccountJson: env.CWS_SERVICE_ACCOUNT_JSON,
    clientId: env.CWS_CLIENT_ID,
    clientSecret: env.CWS_CLIENT_SECRET,
    refreshToken: env.CWS_REFRESH_TOKEN,
  });
  // GitHub hides any later occurrence of a masked value in the job log.
  if (env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${token}`);
  const client = storeClient({ publisherId: env.CWS_PUBLISHER_ID, itemId: env.CWS_ITEM_ID, token });
  const result = await releaseToStore({ client, zip, itemId: env.CWS_ITEM_ID, version: options.version, submission: options.submission, deployPercentage });
  if (options.report) writeFileSync(options.report, `${JSON.stringify({ ok: true, ...result, completedAt: new Date().toISOString() }, null, 2)}\n`);
  return `${options.version} uploaded to ${env.CWS_ITEM_ID}; submission: ${options.submission}${result.submissionState ? ` (${result.submissionState})` : ''}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  let parsed = { command: argv[0], options: {} };
  try {
    parsed = parseArgs(argv);
    console.log(`chrome-web-store ${parsed.command}: OK — ${await main(parsed, process.env)}`);
  } catch (error) {
    if (parsed.command === 'release' && parsed.options.report) {
      writeFileSync(parsed.options.report, `${JSON.stringify({ ok: false, error: error.message, failedAt: new Date().toISOString() }, null, 2)}\n`);
    }
    console.error(`chrome-web-store ${parsed.command}: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
