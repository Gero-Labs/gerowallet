import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_PROOF_SERVER_URL, DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9 } from './midnightConfig';
import {
  PROOF_SERVER_RESTART_NOTICE_KEY,
  isProofServerRestartNoticeDone,
  markProofServerRestartNoticeDone,
  mayHaveRunLocalProofServer,
  proofServerRestartNoticeWanted,
  type ProofServerPreferenceSnapshot,
} from './proofServerRestartNotice';

const defaults = (patch: Partial<ProofServerPreferenceSnapshot> = {}): ProofServerPreferenceSnapshot => ({
  mode: 'remote',
  localUrl: DEFAULT_LOCAL_PROOF_SERVER_URL,
  localUrlLedger9: DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9,
  ...patch,
});

describe('who sees the proof server restart notice', () => {
  it('shows to local mode', () => {
    expect(mayHaveRunLocalProofServer(defaults({ mode: 'local' }), false)).toBe(true);
  });

  it('shows to a saved local URL on either ledger, whatever the mode', () => {
    expect(mayHaveRunLocalProofServer(defaults({ localUrl: 'http://127.0.0.1:7000' }), false)).toBe(true);
    expect(mayHaveRunLocalProofServer(defaults({ mode: 'zkpaas', localUrlLedger9: 'http://localhost:7001' }), false)).toBe(true);
  });

  it('shows to "Prove for your phone"', () => {
    expect(mayHaveRunLocalProofServer(defaults(), true)).toBe(true);
  });

  it('never shows to Gero Cloud or Arkhia users with default URLs', () => {
    expect(mayHaveRunLocalProofServer(defaults({ mode: 'remote' }), false)).toBe(false);
    expect(mayHaveRunLocalProofServer(defaults({ mode: 'zkpaas' }), false)).toBe(false);
  });

  it('stops once Done was pressed', () => {
    expect(proofServerRestartNoticeWanted({ proofServer: defaults({ mode: 'local' }), serveProofs: false, done: false })).toBe(true);
    expect(proofServerRestartNoticeWanted({ proofServer: defaults({ mode: 'local' }), serveProofs: false, done: true })).toBe(false);
  });
});

describe('the Done record', () => {
  afterEach(() => localStorage.removeItem(PROOF_SERVER_RESTART_NOTICE_KEY));

  it('is persisted in localStorage, so it survives a restart', () => {
    expect(isProofServerRestartNoticeDone()).toBe(false);
    markProofServerRestartNoticeDone(1_700_000_000_000);
    expect(localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY)).toBe('1700000000000');
    expect(isProofServerRestartNoticeDone()).toBe(true);
  });
});
