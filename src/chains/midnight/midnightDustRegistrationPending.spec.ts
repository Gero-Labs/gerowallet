// Issue 1470: a native DUST registration the server took is pending until the
// chain shows it; the dialog offers no second Register meanwhile.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearDustRegistrationPending, dustRegistrationPendingRevision, dustRegistrationPendingState, markDustRegistrationPending,
  pruneDustRegistrationPending,
} from './midnightDustRegistrationPending';
import { PENDING_EXPIRY_MS } from './midnightPendingSends';

const ADDR = 'mn_addr_preprod1me';

beforeEach(() => localStorage.clear());

describe('a native DUST registration the server took', () => {
  it('is pending, then "Not confirmed" past the time limit, then gone after a day', () => {
    markDustRegistrationPending(ADDR, 'ab', 1_000);
    expect(dustRegistrationPendingState(ADDR, 1_000 + PENDING_EXPIRY_MS - 1)).toBe('pending');
    expect(dustRegistrationPendingState(ADDR, 1_000 + PENDING_EXPIRY_MS)).toBe('unconfirmed');
    expect(dustRegistrationPendingState(ADDR, 1_000 + 24 * 60 * 60_000)).toBeNull();
  });

  it('is per wallet address, and clears once seen or dismissed', () => {
    const before = dustRegistrationPendingRevision.value;
    markDustRegistrationPending(ADDR, 'ab', 1_000);
    expect(dustRegistrationPendingState('mn_addr_preprod1other', 1_000)).toBeNull();
    clearDustRegistrationPending(ADDR);
    expect(dustRegistrationPendingState(ADDR, 1_000)).toBeNull();
    expect(dustRegistrationPendingRevision.value).toBe(before + 2);
  });

  it('prunes records past their day, and those of wallets no longer in the list (never on an empty list)', () => {
    markDustRegistrationPending(ADDR, 'ab', 1_000);
    markDustRegistrationPending('mn_addr_preprod1gone', 'cd', 1_000);
    pruneDustRegistrationPending([], 2_000);
    expect(dustRegistrationPendingState('mn_addr_preprod1gone', 2_000)).toBe('pending');
    pruneDustRegistrationPending([ADDR], 2_000);
    expect(dustRegistrationPendingState('mn_addr_preprod1gone', 2_000)).toBeNull();
    expect(dustRegistrationPendingState(ADDR, 2_000)).toBe('pending');
    pruneDustRegistrationPending([ADDR], 1_000 + 24 * 60 * 60_000);
    expect(JSON.parse(localStorage.getItem('gero.midnightDustRegistrationPending') ?? '{}')).toEqual({});
  });

  it('a corrupt record reads as none', () => {
    localStorage.setItem('gero.midnightDustRegistrationPending', '{not json');
    expect(dustRegistrationPendingState(ADDR, 1)).toBeNull();
  });
});

describe('the registration dialog', () => {
  const dialog = readFileSync(join(__dirname, '../../modules/dashboard/dialogs/DustRegistrationDialog.vue'), 'utf8');

  it('reports "submitted", keeps the pending state in Register\'s place, and keeps Path B and the portal', () => {
    expect(dialog).toContain("if (result.status === 'submitted') {");
    expect(dialog).toContain('markDustRegistrationPending(wallet.baseAddress, result.txHash ?? \'\');');
    // The pending block stands in for Register only; Path B and the portal follow it either way.
    expect(dialog).toMatch(/<template v-if="registrationPending \|\| !inSigningPhase">[\s\S]*?<div\s+v-if="registrationPending"[\s\S]*?<template v-else>[\s\S]*?data-test="dust-register"[\s\S]*?<\/template>\s*<!-- Path B/);
    expect(dialog).toContain('if (!dustAddress.value || writesPaused.value || registrationPending.value) return;');
    expect(dialog).toContain("t('midnight.dustRegistration.submitted')");
    // Waiting is neutral glass; only "Not confirmed" is on the warning pair; only the text is announced.
    expect(dialog).toContain(`registrationPending === 'pending' ? 'registration-pending--waiting glass-tier' : 'registration-pending--unconfirmed'`);
    expect(dialog).toMatch(/<span class="registration-pending__text t-body-sm" role="status">/);
    expect(dialog).toMatch(/<GButton\s+v-if="registrationPending === 'unconfirmed'"\s+tier="tertiary"\s+compact/);
  });

  it('clears the record once the chain shows the registration', () => {
    expect(dialog).toContain("if (status === 'Registered' || status === 'Pending') clearDustRegistrationPending(loggedWallet.value?.baseAddress ?? '');");
  });
});
