import { beforeEach, describe, expect, it } from 'vitest';
import {
  isProofServerLedger9NoticeDone,
  markProofServerLedger9NoticeDone,
  PROOF_SERVER_LEDGER9_NOTICE_KEY,
  proofServerLedger9NoticeWanted,
  resetProofServerLedger9NoticeForTests,
} from './proofServerLedger9Notice';
import { midnightProofServerVersionLine } from './midnightConfig';

beforeEach(() => {
  localStorage.removeItem(PROOF_SERVER_LEDGER9_NOTICE_KEY);
  resetProofServerLedger9NoticeForTests();
});

describe('ledger 9 proof server notice (issue 1475)', () => {
  it('is for local mode on a ledger 9 chain only', () => {
    expect(proofServerLedger9NoticeWanted({ mode: 'local', ledger: 9, done: false })).toBe(true);
    expect(proofServerLedger9NoticeWanted({ mode: 'remote', ledger: 9, done: false })).toBe(false);
    expect(proofServerLedger9NoticeWanted({ mode: 'zkpaas', ledger: 9, done: false })).toBe(false);
    expect(proofServerLedger9NoticeWanted({ mode: 'local', ledger: 8, done: false })).toBe(false);
    expect(proofServerLedger9NoticeWanted({ mode: 'local', ledger: 9, done: true })).toBe(false);
  });

  it('stays dismissed across pages once dismissed', () => {
    expect(isProofServerLedger9NoticeDone()).toBe(false);
    markProofServerLedger9NoticeDone(1234);
    expect(isProofServerLedger9NoticeDone()).toBe(true);
    expect(localStorage.getItem(PROOF_SERVER_LEDGER9_NOTICE_KEY)).toBe('1234');
    resetProofServerLedger9NoticeForTests();
    expect(isProofServerLedger9NoticeDone()).toBe(true);
  });

  it('names the release line, not the pinned patch', () => {
    expect(midnightProofServerVersionLine(9)).toBe('9.0.x');
    expect(midnightProofServerVersionLine(8)).toBe('8.1.x');
  });
});
