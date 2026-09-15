// scripts/dev/governance-dev-proxy.mjs
//
// DEV-ONLY stand-in for the gero-backend governance proxy.
//
// The wallet's governance surface talks to `${VITE_NEXUS_URL}/api/governance/*`,
// which in production is gero-backend's allowlist proxy in front of Nexus. Until
// that proxy deploys (gero-backend feat/nexus-governance-proxy), the live path
// 404s and the UI cannot be exercised against real data.
//
// This server makes local testing possible with ZERO deploy and ZERO
// credentials: Nexus's governance data is itself sourced from Koios, whose
// anonymous public API serves the same rows. We reshape public Koios responses
// into Nexus's exact DTO shapes for the /api/governance/* routes, and
// TRANSPARENTLY FORWARD every other path (tx building, market, prices…) to the
// real backend so the rest of the wallet keeps working.
//
//   node scripts/dev/governance-dev-proxy.mjs        # listens on :8787
//
// then point the dev wallet at it (Vite reads .env.development.local):
//
//   VITE_NEXUS_URL=http://localhost:8787
//
// Caveats, deliberately accepted for a dev stopgap:
//  - Mainnet only (Koios anonymous tier; preprod would need the preprod host).
//  - Tallies are raw Koios numbers — none of Nexus's corrections. Final
//    gov.tools reconciliation still happens against the deployed proxy.
//  - hashValid is always null (no server-side anchor verification here).
//  - Anonymous Koios is rate-limited; responses are cached for 60s.

import http from 'node:http';

const PORT = Number(process.env.GOV_DEV_PROXY_PORT ?? 8787);
const KOIOS = 'https://api.koios.rest/api/v1';
const REAL_BACKEND = process.env.GOV_DEV_PROXY_UPSTREAM ?? 'https://api.gerowallet.io/api/nexus';
const CACHE_MS = 60_000;

const cache = new Map(); // url -> { at, json }

async function koios(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.json;
  const res = await fetch(`${KOIOS}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Koios ${res.status} on ${path}`);
  const json = await res.json();
  cache.set(path, { at: Date.now(), json });
  return json;
}

/** CIP-100 fields may be plain strings or JSON-LD {"@value": "..."} wrappers. */
function ldString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v['@value'] === 'string') return v['@value'];
  return null;
}

function deriveStatus(row) {
  if (row.enacted_epoch != null) return 'enacted';
  if (row.ratified_epoch != null) return 'ratified';
  if (row.expired_epoch != null) return 'expired';
  if (row.dropped_epoch != null) return 'dropped';
  return 'active';
}

function toProposal(row) {
  return {
    govActionId: `${row.proposal_tx_hash}#${row.proposal_index}`,
    govActionIdCip129: row.proposal_id ?? null,
    txHash: row.proposal_tx_hash,
    index: row.proposal_index,
    slot: null,
    type: row.proposal_type,
    status: deriveStatus(row),
    deposit: row.deposit != null ? String(row.deposit) : null,
    returnAddress: row.return_address ?? null,
    anchorUrl: row.meta_url ?? null,
    anchorHash: row.meta_hash ?? null,
    title: ldString(row.meta_json?.body?.title),
    submittedEpoch: row.proposed_epoch ?? null,
    expiresEpoch: row.expiration ?? null,
  };
}

function toProposalDetail(row) {
  const body = row.meta_json?.body ?? {};
  return {
    ...toProposal(row),
    govAction: row.proposal_description ?? null,
    rawMetadata: row.meta_json ?? null,
    abstractText: ldString(body.abstract),
    motivation: ldString(body.motivation),
    rationale: ldString(body.rationale),
    references: Array.isArray(body.references) ? body.references : null,
    authors: Array.isArray(row.meta_json?.authors)
      ? row.meta_json.authors.map((a) => ldString(a?.name)).filter(Boolean)
      : null,
    // No anchor verification in the dev shim — null means "not checked",
    // which the UI renders as "unverified", never as "invalid".
    hashValid: null,
  };
}

function toVotingSummary(row) {
  return {
    epochNo: row.epoch_no ?? null,
    yesVotePower: row.drep_yes_vote_power ?? null,
    noVotePower: row.drep_no_vote_power ?? null,
    abstainVotePower: row.drep_active_abstain_vote_power ?? null,
    yesPct: row.drep_yes_pct ?? null,
    noPct: row.drep_no_pct ?? null,
    yesVotesCast: row.drep_yes_votes_cast ?? null,
    noVotesCast: row.drep_no_votes_cast ?? null,
    abstainVotesCast: row.drep_abstain_votes_cast ?? null,
    alwaysNoConfidenceVotePower: row.drep_always_no_confidence_vote_power ?? null,
    alwaysAbstainVotePower: row.drep_always_abstain_vote_power ?? null,
    ccYesVotes: row.committee_yes_votes_cast ?? null,
    ccNoVotes: row.committee_no_votes_cast ?? null,
    ccAbstainVotes: row.committee_abstain_votes_cast ?? null,
    ccThreshold: null,
    ccYesPct: row.committee_yes_pct ?? null,
    ccNoPct: row.committee_no_pct ?? null,
    spoYesVotesCast: row.pool_yes_votes_cast ?? null,
    spoNoVotesCast: row.pool_no_votes_cast ?? null,
    spoAbstainVotesCast: row.pool_abstain_votes_cast ?? null,
    spoYesVotePower: row.pool_yes_vote_power ?? null,
    spoNoVotePower: row.pool_no_vote_power ?? null,
    spoAbstainVotePower: row.pool_active_abstain_vote_power ?? null,
    spoNotVotedPower: null,
    spoYesPct: row.pool_yes_pct ?? null,
    spoNoPct: row.pool_no_pct ?? null,
    notVotedPower: null,
  };
}

// Koios /proposal_votes row keys, verified live 2026-08-23:
//   block_time, voter_role, voter_id, voter_hex, voter_has_script, vote,
//   meta_url, meta_hash
// Note there is NO vote_tx_hash key, so `txHash` is null on every row here. Do
// not build a "view the vote transaction" affordance on it without confirming
// production carries one.
function toVote(row) {
  return {
    voterRole: row.voter_role ?? null,
    voterHash: row.voter_hex ?? null,
    drepId: row.voter_role === 'DRep' ? (row.voter_id ?? null) : null,
    vote: row.vote ?? null,
    txHash: row.vote_tx_hash ?? null,
    votedAt: row.block_time ?? null,
    rationaleUrl: row.meta_url ?? null,
    rationaleHash: row.meta_hash ?? null,
    hasScript: typeof row.voter_has_script === 'boolean' ? row.voter_has_script : null,
    // Role-agnostic: an SPO row carries a bech32 pool id here, which the DRep
    // -only `drepId` above throws away.
    voterId: row.voter_id ?? null,
  };
}

async function findRow(txHash, index) {
  const list = await koios('/proposal_list');
  return list.find((r) => r.proposal_tx_hash === txHash && r.proposal_index === Number(index)) ?? null;
}

function page(items, params) {
  const pageNo = Math.max(1, Number(params.get('page') ?? 1));
  const pageSize = Math.max(1, Math.min(100, Number(params.get('pageSize') ?? 50)));
  return {
    items: items.slice((pageNo - 1) * pageSize, pageNo * pageSize),
    page: pageNo,
    pageSize,
    total: items.length,
  };
}

async function handleGovernance(pathname, params) {
  if (pathname === '/api/governance/proposals') {
    let rows = await koios('/proposal_list');
    const type = params.get('type');
    const status = params.get('status');
    if (type) rows = rows.filter((r) => r.proposal_type === type);
    if (status) rows = rows.filter((r) => deriveStatus(r) === status.toLowerCase());
    // Newest first, matching a directory's natural reading order.
    rows = [...rows].sort((a, b) => (b.proposed_epoch ?? 0) - (a.proposed_epoch ?? 0));
    const p = page(rows, params);
    return { status: 200, body: { ...p, items: p.items.map(toProposal) } };
  }

  const m = pathname.match(/^\/api\/governance\/proposals\/([0-9a-fA-F]{64})\/(\d+)(?:\/(votes|voting-summary))?$/);
  if (m) {
    const [, txHash, index, sub] = m;
    const row = await findRow(txHash.toLowerCase(), index);
    if (!row) return { status: 404, body: { message: 'Governance action not found' } };
    if (!sub) return { status: 200, body: toProposalDetail(row) };
    if (sub === 'voting-summary') {
      const rows = await koios(`/proposal_voting_summary?_proposal_id=${row.proposal_id}`);
      if (!rows.length) return { status: 404, body: { message: 'No voting summary' } };
      return { status: 200, body: toVotingSummary(rows[0]) };
    }
    const votes = await koios(`/proposal_votes?_proposal_id=${row.proposal_id}`);
    const p = page(votes, params);
    return { status: 200, body: { ...p, items: p.items.map(toVote) } };
  }

  if (pathname === '/api/governance/committee') {
    const rows = await koios('/committee_info');
    const info = rows[0] ?? {};
    return {
      status: 200,
      body: {
        thresholdNumerator: info.quorum_numerator ?? null,
        thresholdDenominator: info.quorum_denominator ?? null,
        members: (info.members ?? []).map((mm) => ({
          hash: mm.cc_cold_hex ?? mm.cc_cold_id ?? '',
          credType: null,
          startEpoch: null,
          expiredEpoch: mm.expiration_epoch ?? null,
        })),
      },
    };
  }

  if (pathname === '/api/governance/constitution') {
    // Koios has no stable public constitution endpoint on the anonymous tier;
    // serve nulls — the UI treats absent fields as "not available".
    return { status: 200, body: { activeEpoch: null, anchorUrl: null, anchorHash: null, script: null } };
  }

  return null;
}

/** Everything that is not /api/governance/* goes to the real backend untouched. */
async function passThrough(req, res, pathname, search) {
  const upstream = `${REAL_BACKEND}${pathname}${search}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const upstreamRes = await fetch(upstream, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });
  const text = await upstreamRes.text();
  res.writeHead(upstreamRes.status, {
    'content-type': upstreamRes.headers.get('content-type') ?? 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  try {
    const handled = req.method === 'GET' ? await handleGovernance(url.pathname, url.searchParams) : null;
    if (handled) {
      res.writeHead(handled.status, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify(handled.body));
      console.log(`[gov-shim] ${handled.status} ${url.pathname}`);
      return;
    }
    await passThrough(req, res, url.pathname, url.search);
    console.log(`[gov-shim] pass-through ${req.method} ${url.pathname}`);
  } catch (err) {
    console.error(`[gov-shim] error on ${url.pathname}:`, err.message);
    res.writeHead(502, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ message: `governance dev proxy error: ${err.message}` }));
  }
});

server.listen(PORT, () => {
  console.log(`[gov-shim] listening on http://localhost:${PORT}`);
  console.log(`[gov-shim] /api/governance/* served from public Koios (mainnet, 60s cache)`);
  console.log(`[gov-shim] everything else forwarded to ${REAL_BACKEND}`);
});
