import { describe, expect, it } from 'vitest';
import { check, MAX_FUTURE_MS, MAX_LIFETIME_MS, MAX_PAYLOAD, type AnnouncementTier } from './announcementRules';
import { at, bytes, editorial, feed, ID, NOW, type Doc } from './__fixtures__/docs';

// A port of gero-sync's AnnouncementRulesTest: the same documents and the same verdicts.

function verdict(doc: Doc, tier: AnnouncementTier): string | null {
  const r = check(bytes(doc), tier, NOW);
  return r.ok === false ? r.refusal : null;
}
function ofEditorial(change: (d: Doc) => void): string | null {
  const d = editorial();
  change(d);
  return verdict(d, 'editorial');
}
function ofFeed(change: (d: Doc) => void): string | null {
  const d = feed();
  change(d);
  return verdict(d, 'feed');
}
const firstMedia = (d: Doc) => (d['media'] as Doc[])[0]!;

describe('announcement content rules', () => {
  it('accept the full editorial document and parse it', () => {
    const r = check(bytes(editorial()), 'editorial', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.document.id).toBe(ID);
    expect(r.document.kind).toBe('service');
    expect(r.document.platforms).toEqual(['extension', 'ios', 'android']);
    expect(r.document.media).toHaveLength(1);
    expect(r.document.actionRoute).toBe('/staking');
    expect(r.document.actionUrl).toBeNull();
    expect(r.document.content['de']?.title).toBe('Mainnet-Synchronisierung verzögert');
  });

  it('accept the feed headline', () => {
    expect(verdict(feed(), 'feed')).toBeNull();
  });

  it('check the structure', () => {
    const raw = (s: string) => { const r = check(new TextEncoder().encode(s), 'editorial', NOW); return r.ok === false ? r.refusal : null; };
    expect(raw('[1]')).toBe('bad_json');
    expect(raw('{')).toBe('bad_json');
    expect(raw('null')).toBe('bad_json');
    const tooLarge = check(new Uint8Array(MAX_PAYLOAD + 1), 'editorial', NOW);
    expect(tooLarge.ok === false ? tooLarge.refusal : null).toBe('too_large');
    const invalidUtf8 = check(new Uint8Array([0x7b, 0xff, 0x7d]), 'editorial', NOW);
    expect(invalidUtf8.ok === false ? invalidUtf8.refusal : null).toBe('bad_json');
    expect(ofEditorial((d) => { d['v'] = 2; })).toBe('bad_version');
    expect(ofEditorial((d) => { d['v'] = '1'; })).toBe('bad_version');
    expect(ofEditorial((d) => { d['id'] = 'not-a-ulid'; })).toBe('bad_id');
    expect(ofEditorial((d) => { d['kind'] = 'promo'; })).toBe('bad_kind');
    expect(ofEditorial((d) => { d['severity'] = 'urgent'; })).toBe('bad_severity');
  });

  it('check the times', () => {
    expect(ofEditorial((d) => { d['exp'] = 'tomorrow'; })).toBe('bad_time');
    expect(ofEditorial((d) => { d['exp'] = d['ts']; })).toBe('bad_time');
    expect(ofEditorial((d) => { d['exp'] = (d['ts'] as number) + MAX_LIFETIME_MS + 1; })).toBe('lifetime_too_long');
    expect(ofEditorial((d) => { d['ts'] = NOW + MAX_FUTURE_MS + 1; d['exp'] = NOW + MAX_FUTURE_MS + 2; })).toBe('ts_in_future');
    expect(ofEditorial((d) => { d['ts'] = NOW - 7_200_000; d['exp'] = NOW - 1; })).toBe('expired');
  });

  it('check the audience', () => {
    expect(ofEditorial((d) => { at(d, 'audience')['platforms'] = []; })).toBe('bad_audience');
    expect(ofEditorial((d) => { at(d, 'audience')['platforms'] = ['windows']; })).toBe('bad_audience');
    expect(ofEditorial((d) => { at(d, 'audience')['networks'] = ['Cardano Mainnet']; })).toBe('bad_audience');
    expect(ofEditorial((d) => { at(d, 'audience')['networks'] = null; })).toBe('bad_audience');
    expect(ofEditorial((d) => { at(d, 'audience')['minVersion'] = { extension: 'latest' }; })).toBe('bad_audience');
    expect(ofEditorial((d) => { delete at(d, 'audience')['networks']; delete at(d, 'audience')['minVersion']; })).toBeNull();
  });

  it('check the content', () => {
    expect(ofEditorial((d) => { delete at(d, 'content')['en']; })).toBe('bad_content');
    expect(ofEditorial((d) => { at(d, 'content')['fr'] = { title: 'a', summary: 'b', body: 'c' }; })).toBe('bad_content');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['title'] = 'x'.repeat(81); })).toBe('title_too_long');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['title'] = 'x'.repeat(80); })).toBeNull();
    // 41 emoji are 41 code points and 82 UTF-16 units: the limit counts units.
    expect(ofEditorial((d) => { at(d, 'content', 'en')['title'] = '\u{1F680}'.repeat(41); })).toBe('title_too_long');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['summary'] = 'x'.repeat(201); })).toBe('summary_too_long');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['body'] = 'x'.repeat(20_001); })).toBe('body_too_long');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['title'] = ''; })).toBe('bad_content');
    expect(ofEditorial((d) => { at(d, 'content', 'en')['body'] = null; })).toBe('bad_content');
  });

  it('check the media', () => {
    expect(ofEditorial((d) => { firstMedia(d)['type'] = 'image/svg+xml'; })).toBe('bad_media');
    expect(ofEditorial((d) => { firstMedia(d)['bytes'] = 524_289; })).toBe('bad_media');
    expect(ofEditorial((d) => { d['media'] = null; })).toBe('bad_media');
    expect(ofEditorial((d) => { d['thumb'] = '0'.repeat(64); })).toBe('bad_thumb');
    expect(ofEditorial((d) => { d['thumb'] = null; })).toBe('bad_thumb');
    expect(ofEditorial((d) => { at(d, 'content', 'de')['body'] = `![x](media:${'0'.repeat(64)})`; })).toBe('bad_media_ref');
  });

  it('check the action', () => {
    expect(ofEditorial((d) => { d['action'] = { url: 'https://example.com/' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { url: 'https://gerowallet.io.evil.com/' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { url: 'https://gerowallet.io@evil.com/' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { url: 'http://gerowallet.io/' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { url: 'javascript:alert(1)' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { route: '/send?to=addr1' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { route: '/a', url: 'https://gerowallet.io/' }; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = null; })).toBe('bad_action');
    expect(ofEditorial((d) => { d['action'] = { url: 'https://support.gerowallet.io/help/sync' }; })).toBeNull();
    expect(ofEditorial((d) => { delete d['action']; })).toBeNull();
  });

  it('hold the feed tier to headlines', () => {
    expect(ofFeed((d) => { d['kind'] = 'service'; })).toBe('tier_limit');
    expect(ofFeed((d) => { d['severity'] = 'critical'; })).toBe('tier_limit');
    expect(ofFeed((d) => { at(d, 'content', 'en')['body'] = 'text'; })).toBe('tier_limit');
    expect(ofFeed((d) => { d['action'] = { route: '/staking' }; })).toBe('tier_limit');
    expect(ofFeed((d) => { at(d, 'content', 'en')['title'] = 'Claim at gero-airdrop.com'; })).toBe('feed_text_not_allowed');
    expect(ofFeed((d) => { at(d, 'content', 'en')['summary'] = 'Send to addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkf'; })).toBe('feed_text_not_allowed');
    expect(ofFeed((d) => { at(d, 'content', 'en')['title'] = 'Go to https://x'; })).toBe('feed_text_not_allowed');
    expect(ofFeed((d) => { at(d, 'content', 'en')['title'] = 'Version 2.9 is out'; })).toBeNull();
  });
});
