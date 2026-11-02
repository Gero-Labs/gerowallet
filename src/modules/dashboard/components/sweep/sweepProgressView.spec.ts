// How the progress panel reads the signer's hooks: which transaction is where, and what each row says.
import { describe, expect, it } from 'vitest';
import { sweepProgressView, type SweepChecklistRow } from './sweepProgressView';

type RowView = Pick<SweepChecklistRow, 'state' | 'detail'>;
const rows = (view: ReturnType<typeof sweepProgressView>): Record<SweepChecklistRow['id'], RowView> =>
  Object.fromEntries(view!.rows.map((row) => [row.id, { state: row.state, detail: row.detail }])) as Record<SweepChecklistRow['id'], RowView>;

describe('sweepProgressView', () => {
  it('shows nothing with neither progress nor a stop', () => {
    expect(sweepProgressView(null, null)).toBeNull();
  });

  it('while signing: nothing sent, every cell pending, the sign row counting', () => {
    const view = sweepProgressView({ phase: 'signing', step: 3, total: 11 }, null)!;
    expect(view.title).toEqual({ key: 'send.sweepSigning', params: { step: 3, total: 11 } });
    expect(view.count).toEqual({ key: 'send.sweepNothingSent' });
    expect(view.segments).toEqual(Array(11).fill('pending'));
    expect(rows(view)).toEqual({
      sign: { state: 'active', detail: { key: 'send.sweepSignedCount', params: { signed: 2, total: 11 } } },
      merges: { state: 'pending', detail: { key: 'send.sweepNotSentYet' } },
      payment: { state: 'pending', detail: { key: 'send.sweepNotSentYet' } },
    });
    expect(view.caption).toEqual({ key: 'send.sweepSigningNote' });
    expect(view.stop).toBeNull();
  });

  it('while sending a merge: the ones before it done, it active, the payment still to come', () => {
    const view = sweepProgressView({ phase: 'sending', step: 7, total: 11 }, null)!;
    expect(view.title).toEqual({ key: 'send.sweepSending', params: { step: 7, total: 11 } });
    expect(view.count).toEqual({ key: 'send.sweepSentCount', params: { sent: 6, total: 11 } });
    expect(view.segments).toEqual([...Array(6).fill('done'), 'active', ...Array(4).fill('pending')]);
    expect(rows(view)).toEqual({
      sign: { state: 'done', detail: { key: 'send.sweepSignedCount', params: { signed: 11, total: 11 } } },
      merges: { state: 'active', detail: { key: 'send.sweepMergesSentCount', params: { sent: 6, merges: 10 } } },
      payment: { state: 'pending', detail: { key: 'send.sweepPaymentAfterMerges' } },
    });
    expect(view.caption).toEqual({ key: 'send.sweepKeepOpen' });
  });

  it('while sending the payment: every merge done, the payment going out', () => {
    const view = sweepProgressView({ phase: 'sending', step: 11, total: 11 }, null)!;
    expect(view.count).toEqual({ key: 'send.sweepSentCount', params: { sent: 10, total: 11 } });
    expect(view.segments).toEqual([...Array(10).fill('done'), 'active']);
    expect(rows(view).merges).toEqual({ state: 'done', detail: { key: 'send.sweepMergesSentCount', params: { sent: 10, merges: 10 } } });
    expect(rows(view).payment).toEqual({ state: 'active', detail: { key: 'send.sweepPaymentGoingOut' } });
  });

  it('while waiting for the merges to land: the payment waits, with its own note', () => {
    const view = sweepProgressView({ phase: 'waiting', step: 11, total: 11 }, null)!;
    expect(view.title).toEqual({ key: 'send.sweepWaiting' });
    expect(view.count).toEqual({ key: 'send.sweepSentCount', params: { sent: 10, total: 11 } });
    expect(view.segments).toEqual([...Array(10).fill('done'), 'active']);
    expect(rows(view).merges.state).toBe('done');
    expect(rows(view).payment).toEqual({ state: 'active', detail: { key: 'send.sweepPaymentWaiting' } });
    expect(view.caption).toEqual({ key: 'send.sweepWaitingNote' });
  });

  it('a running sweep wins over a stop still on screen', () => {
    const view = sweepProgressView({ phase: 'signing', step: 1, total: 2 }, { step: 1, total: 2, mergesSent: 0, reason: 'x' })!;
    expect(view.stop).toBeNull();
    expect(view.title?.key).toBe('send.sweepSigning');
  });

  it('stopped at a merge: the sent ones done, that one in error, the payment never sent', () => {
    const view = sweepProgressView(null, { step: 4, total: 11, mergesSent: 3, reason: 'ValueNotConservedUTxO' })!;
    expect(view.title).toBeNull();
    expect(view.count).toBeNull();
    expect(view.caption).toBeNull();
    expect(view.segments).toEqual([...Array(3).fill('done'), 'error', ...Array(7).fill('pending')]);
    expect(rows(view)).toEqual({
      sign: { state: 'done', detail: { key: 'send.sweepSignedCount', params: { signed: 11, total: 11 } } },
      merges: { state: 'error', detail: { key: 'send.sweepMergesStopped', params: { sent: 3, merges: 10 } } },
      payment: { state: 'pending', detail: { key: 'send.sweepPaymentNotSent' } },
    });
    expect(view.stop).toEqual({
      title: { key: 'send.sweepStoppedTitle', params: { step: 4, total: 11 } },
      body: { key: 'send.sweepStoppedBody', params: { sent: 3, merges: 10 }, choice: 10 },
      reason: 'ValueNotConservedUTxO',
      tryAgain: { key: 'send.sweepTryAgainNote', params: { step: 4 } },
    });
  });

  it('stopped at the payment: every merge done, the payment in error', () => {
    const view = sweepProgressView(null, { step: 11, total: 11, mergesSent: 10, reason: 'refused' })!;
    expect(view.segments).toEqual([...Array(10).fill('done'), 'error']);
    expect(rows(view).merges).toEqual({ state: 'done', detail: { key: 'send.sweepMergesSentCount', params: { sent: 10, merges: 10 } } });
    expect(rows(view).payment).toEqual({ state: 'error', detail: { key: 'send.sweepPaymentNotSent' } });
  });
});
