// Test support for the pages: announcements as the worker stores them (a document that passed the
// rules, with its tier), built from the same fixtures the verifier tests use.

import { check, type AnnouncementTier } from '../announcementRules';
import { verificationFingerprint, type AnnouncementsSnapshot, type StoredAnnouncement } from '../announcementStore';
import { at, bytes, editorial, feed, NOW, TEST_KEYS, type Doc } from './docs';

export const VERSION = '2.9.0';
export const annId = (n: number) => `01JC00000000000000000000${String(n).padStart(2, '0')}`;

export function stored(doc: Doc, tier: AnnouncementTier = 'editorial'): StoredAnnouncement {
  const r = check(bytes(doc), tier, NOW);
  if (r.ok === false) throw new Error(r.refusal);
  return { document: r.document, tier, firstSeenAt: NOW };
}

/** A plain editorial document for everyone: a product update unless `change` says otherwise. */
export function plainDoc(n: number, change: (d: Doc) => void = () => undefined): Doc {
  const d = editorial();
  d['id'] = annId(n);
  d['kind'] = 'product';
  d['severity'] = 'info';
  d['ts'] = NOW - n * 60_000;
  delete d['thumb'];
  delete d['media'];
  delete d['action'];
  delete at(d, 'audience')['networks'];
  delete at(d, 'audience')['minVersion'];
  at(d, 'content', 'en')['title'] = `Title ${n}`;
  at(d, 'content', 'en')['summary'] = `Summary ${n}`;
  at(d, 'content', 'en')['body'] = `Body ${n}`;
  at(d, 'content', 'de')['title'] = `Titel ${n}`;
  at(d, 'content', 'de')['summary'] = `Kurz ${n}`;
  at(d, 'content', 'de')['body'] = `Text ${n}`;
  change(d);
  return d;
}

export const product = (n: number, change?: (d: Doc) => void) => stored(plainDoc(n, change));
export const critical = (n: number, change?: (d: Doc) => void) => stored(plainDoc(n, (d) => { d['kind'] = 'service'; d['severity'] = 'critical'; change?.(d); }));
export const warning = (n: number) => stored(plainDoc(n, (d) => { d['kind'] = 'service'; d['severity'] = 'warning'; }));

/** A blog headline, signed by the feed key: no body, a link to gerowallet.io. */
export function headline(n: number): StoredAnnouncement {
  const d = feed();
  d['id'] = annId(n);
  d['ts'] = NOW - n * 60_000;
  delete at(d, 'audience')['networks'];
  delete at(d, 'audience')['minVersion'];
  return stored(d, 'feed');
}

/** A snapshot this build (VERSION + the test keys) verified. */
export function snapshotOf(items: StoredAnnouncement[], version = VERSION): AnnouncementsSnapshot {
  return { seq: 1, fetchedAt: NOW, failures: 0, failedAt: 0, verifiedWith: verificationFingerprint(version, TEST_KEYS) ?? '', items };
}
