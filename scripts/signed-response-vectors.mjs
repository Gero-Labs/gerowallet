#!/usr/bin/env node
/**
 * Generates the shared test vectors for Gero's signed responses (profile gero-v1).
 *
 *   node scripts/signed-response-vectors.mjs > src/shared/utils/signedResponse.vectors.json
 *
 * The same JSON is copied into Nexus and gero-backend
 * (src/test/resources/signed-response/vectors.json). Each implementation must
 * rebuild every `signatureBase` and, from the test seed, every `signature`
 * byte for byte (Ed25519 is deterministic). The wallet must also verify them.
 *
 * Every key here is a TEST key derived from a public label. None of them may ever
 * be pinned in a shipped build or configured on a server.
 */
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import MS from '@emurgo/cardano-message-signing-nodejs';

ed.hashes.sha512 = sha512;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const utf8 = (text) => new TextEncoder().encode(text);
const testSeed = (label) => sha256(utf8(label));

const SIGNING_SEED = testSeed('gero-v1 TEST signing key; never use in production');
const SIGNING_PUB = ed.getPublicKey(SIGNING_SEED);
const ROOT_SEED = testSeed('gero-v1 TEST root key; never pin in a shipped build');
const ROOT_PUB = ed.getPublicKey(ROOT_SEED);
const KEYID = 'backend-test';

const digestHeader = (bytes) => `sha-256=:${b64(sha256(bytes))}:`;

/** The covered components, in order. Chain tip only when the response carries it. */
function components(withTip) {
  const list = ['"@method";req', '"@path";req', '"@query";req', '"@status"', '"gero-request-digest"', '"gero-body-digest"'];
  if (withTip) list.push('"gero-chain-tip"');
  return list;
}

function signatureParams(withTip, created, expires, keyid) {
  return `(${components(withTip).join(' ')});created=${created};expires=${expires};keyid="${keyid}";alg="ed25519";tag="gero-v1"`;
}

function signatureBase({ method, path, query, status, requestDigest, bodyDigest, chainTip, params }) {
  const lines = [
    `"@method";req: ${method}`,
    `"@path";req: ${path}`,
    `"@query";req: ${query ? `?${query}` : '?'}`,
    `"@status": ${status}`,
    `"gero-request-digest": ${requestDigest}`,
    `"gero-body-digest": ${bodyDigest}`,
  ];
  if (chainTip !== undefined) lines.push(`"gero-chain-tip": ${chainTip}`);
  lines.push(`"@signature-params": ${params}`);
  return lines.join('\n');
}

const CREATED = 1761955200; // 2025-11-01T00:00:00Z
const EXPIRES = CREATED + 300;

const cases = [
  {
    name: 'delegation build relayed from Nexus',
    request: { method: 'POST', path: '/api/nexus/api/tx/build/delegation', query: 'network=MAINNET', body: '{"stakeAddress":"stake1uxyz","poolId":"pool1abc"}' },
    response: { status: 200, body: '{"cbor":"84a400","estimated_fee":"171045"}' },
  },
  {
    name: 'pool list with non-ASCII text',
    request: { method: 'GET', path: '/api/pools', query: '', body: '' },
    response: { status: 200, body: '[{"ticker":"ÆGIS","name":"Pool ✓ ünïcode","id":"pool1xyz"}]' },
  },
  {
    name: 'handle lookup refused',
    request: { method: 'GET', path: '/api/assets/handle', query: 'name=alice&network=MAINNET', body: '' },
    response: { status: 404, body: '{"message":"Handle not found"}' },
  },
  {
    name: 'empty body with chain tip',
    request: { method: 'POST', path: '/api/nexus/api/collateral/lend', query: 'network=PREPROD', body: '{"ref":"aa#0"}' },
    response: { status: 204, body: '', chainTip: '171234567,0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0' },
  },
];

const out = {
  profile: 'gero-v1',
  note: 'TEST keys derived from public labels. Never pin or configure them anywhere real.',
  signingSeedHex: hex(SIGNING_SEED),
  signingPublicKeyHex: hex(SIGNING_PUB),
  keyid: KEYID,
  created: CREATED,
  expires: EXPIRES,
  cases: [],
  root: {},
};

for (const c of cases) {
  const withTip = c.response.chainTip !== undefined;
  const requestDigest = digestHeader(utf8(c.request.body));
  const bodyDigest = digestHeader(utf8(c.response.body));
  const params = signatureParams(withTip, CREATED, EXPIRES, KEYID);
  const base = signatureBase({
    method: c.request.method,
    path: c.request.path,
    query: c.request.query,
    status: c.response.status,
    requestDigest,
    bodyDigest,
    chainTip: c.response.chainTip,
    params,
  });
  const signature = ed.sign(utf8(base), SIGNING_SEED);
  out.cases.push({
    ...c,
    expected: {
      requestDigest,
      bodyDigest,
      signatureInput: `gero=${params}`,
      signatureBase: base,
      signature: `gero=:${b64(signature)}:`,
    },
  });
}

// A root-signed delegation for the test signing key, shaped like the CIP-8
// (COSE_Sign1) signature a Ledger, Trezor or Keystone returns from signData.
const statement =
  'gero-delegation-v1\n' +
  JSON.stringify({
    kid: KEYID,
    pub: hex(SIGNING_PUB),
    service: 'gero-backend',
    hosts: ['api.gerowallet.io'],
    notBefore: '2025-10-01T00:00:00Z',
    notAfter: '2026-04-01T00:00:00Z',
  });
const rewardAddress = new Uint8Array([0xe1, ...blake2b(ROOT_PUB, { dkLen: 28 })]);
const protectedMap = MS.HeaderMap.new();
protectedMap.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
protectedMap.set_header(MS.Label.new_text('address'), MS.CBORValue.new_bytes(rewardAddress));
const unprotectedMap = MS.HeaderMap.new();
unprotectedMap.set_header(MS.Label.new_text('hashed'), MS.CBORValue.new_special(MS.CBORSpecial.new_bool(false)));
const headers = MS.Headers.new(MS.ProtectedHeaderMap.new(protectedMap), unprotectedMap);
const builder = MS.COSESign1Builder.new(headers, utf8(statement), false);
const coseSign1 = builder.build(ed.sign(builder.make_data_to_sign().to_bytes(), ROOT_SEED));

out.root = {
  seedHex: hex(ROOT_SEED),
  publicKeyHex: hex(ROOT_PUB),
  delegation: { statement, coseSign1: hex(coseSign1.to_bytes()) },
};

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
