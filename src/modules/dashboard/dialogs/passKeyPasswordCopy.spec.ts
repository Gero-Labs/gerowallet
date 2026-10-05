// The PassKey-encrypted copy of the spending password (`passKeyEncryptedSpendingPassword`)
// exists only for PassKey password autofill: PassKey unlock authenticates with WebAuthn
// alone. Anyone holding this device's data and the passkey can recover the password from
// that copy, so it must not outlive the feature. These dialogs have no mount harness;
// the tripwires pin each path that has to drop the copy.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const DROP = "where({ key: 'passKeyEncryptedSpendingPassword' }).delete()";

/** The source between two markers (the end marker excluded). */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing marker: ${start}`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing marker: ${end}`).toBeGreaterThan(-1);
  return source.slice(from, to);
}

describe('PassKey-encrypted spending password copy', () => {
  const lock = read('LockSettingsDialog.vue');
  const change = read('ChangePasswordDialog.vue');

  it('is dropped when the unlock method is set to None (which also turns autofill off)', () => {
    const branch = between(lock, 'if (method === null) {', "await configTable.put({ key: 'unlockMethod', value: method });");
    expect(branch).toContain(DROP);
    expect(branch).toContain("put({ key: 'passKeyForPasswordAutofill', value: false })");
  });

  it('is dropped when PassKey autofill is turned off', () => {
    const fn = between(lock, 'async function handlePassKeyAutofillChange(', "await configTable.put({ key: 'passKeyForPasswordAutofill', value: enabled });");
    const disabling = fn.slice(fn.lastIndexOf('} else {'));
    expect(disabling).toContain(DROP);
  });

  it('is dropped, not left holding the old password, on a password change with autofill off or a failed re-encrypt', () => {
    const block = between(change, 'Check if PassKey autofill is enabled and auto-update encrypted password', "snackbar.fireSuccess(t('dashboard.spendingPasswordChanged'))");
    const afterReencrypt = block.slice(block.indexOf('value: encryptedPassword'));
    const elseBranch = between(afterReencrypt, '} else {', '} catch (passKeyError) {');
    expect(elseBranch).toContain(DROP);
    expect(afterReencrypt.slice(afterReencrypt.indexOf('} catch (passKeyError) {'))).toContain(DROP);
  });
});
