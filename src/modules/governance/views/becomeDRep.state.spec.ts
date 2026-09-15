import { describe, it, expect } from 'vitest';
import { anchorIdentity, isRegisteredDRep } from '@/modules/governance/views/becomeDRep.state';

describe('isRegisteredDRep', () => {
  it('is true for a live registration', () => {
    expect(isRegisteredDRep({ registered: true })).toBe(true);
  });

  it('is FALSE for a retired DRep, so it can register again', () => {
    // The regression: a retired DRep still has a row. Keying off the row's mere
    // existence stranded the user on the retire panel with no way back.
    expect(isRegisteredDRep({ registered: false })).toBe(false);
  });

  it('is false when there is no row at all', () => {
    expect(isRegisteredDRep(null)).toBe(false);
    expect(isRegisteredDRep(undefined)).toBe(false);
  });

  it('treats an unprojected field as registered, never as a chance to re-register', () => {
    // Only an explicit false is retirement. A missing field must not send an
    // already-registered DRep back through registration: that locks a second
    // deposit on a certificate the chain will reject.
    expect(isRegisteredDRep({})).toBe(true);
    expect(isRegisteredDRep({ registered: null })).toBe(true);
    expect(isRegisteredDRep({ registered: undefined })).toBe(true);
  });
});

describe('anchorIdentity', () => {
  const HASH = '3cb47c310b41dfa8d88904a26f0501b3804ffcb6732555a6f5b69f13a53b03ef';

  it('is stable for the same url and hash', () => {
    expect(anchorIdentity('https://example.org/a.jsonld', HASH)).toBe(
      anchorIdentity('https://example.org/a.jsonld', HASH)
    );
  });

  it('changes when the URL changes, even though the document did not', () => {
    expect(anchorIdentity('https://example.org/a.jsonld', HASH)).not.toBe(
      anchorIdentity('https://example.org/b.jsonld', HASH)
    );
  });

  it('changes when the document hash changes, even at the same URL', () => {
    expect(anchorIdentity('https://example.org/a.jsonld', HASH)).not.toBe(
      anchorIdentity('https://example.org/a.jsonld', HASH.replace(/^3/, '4'))
    );
  });

  it('ignores surrounding whitespace and hash casing', () => {
    expect(anchorIdentity('  https://example.org/a.jsonld  ', HASH.toUpperCase())).toBe(
      anchorIdentity('https://example.org/a.jsonld', HASH)
    );
  });

  it('never collides with the empty "nothing built yet" marker', () => {
    expect(anchorIdentity('', '')).not.toBe('');
  });
});

describe('build invalidation (the reported scenario)', () => {
  // Models exactly what the view does: a built transaction is only usable while
  // the anchor it was built for still matches the form. Written as the reported
  // sequence so the regression is legible.
  const HASH = '3cb47c310b41dfa8d88904a26f0501b3804ffcb6732555a6f5b69f13a53b03ef';

  function flow() {
    return {
      url: '',
      hash: HASH,
      builtFor: '',
      build(): void {
        this.builtFor = anchorIdentity(this.url, this.hash);
      },
      get stale(): boolean {
        return this.builtFor !== anchorIdentity(this.url, this.hash);
      },
    };
  }

  it('a fresh build is not stale', () => {
    const state = flow();
    state.url = 'https://example.org/a.jsonld';
    state.build();
    expect(state.stale).toBe(false);
  });

  it('editing ONLY the URL after building invalidates the transaction', () => {
    const state = flow();
    state.url = 'https://example.org/a.jsonld';
    state.build();
    state.url = 'https://example.org/b.jsonld';
    expect(state.stale).toBe(true);
  });

  it('editing the profile after building invalidates the transaction', () => {
    const state = flow();
    state.url = 'https://example.org/a.jsonld';
    state.build();
    state.hash = HASH.replace(/^3/, '4');
    expect(state.stale).toBe(true);
  });

  it('nothing built yet is stale', () => {
    const state = flow();
    state.url = 'https://example.org/a.jsonld';
    expect(state.stale).toBe(true);
  });

  it('rebuilding after the edit clears the staleness', () => {
    const state = flow();
    state.url = 'https://example.org/a.jsonld';
    state.build();
    state.url = 'https://example.org/b.jsonld';
    state.build();
    expect(state.stale).toBe(false);
  });
});
