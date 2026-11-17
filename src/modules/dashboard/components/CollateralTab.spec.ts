import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwire for issue 1558. Set Collateral is the wallet's own transaction, so it must
// sign in-wallet (useTransactionSigning → MessageTypes.SIGN_TX on the options channel). The dApp
// CIP-30 signTx route checks the relay-set request.origin against the connected-dApp whitelist
// and refuses the wallet's own pages, which showed users "The request was refused due to lack
// of access - e.g. wallet disconnects" before any sign window opened.
const tab = readFileSync(join(__dirname, 'CollateralTab.vue'), 'utf8');
const dialog = readFileSync(join(__dirname, '..', 'dialogs', 'SetCollateralDialog.vue'), 'utf8');

describe('Set Collateral signing (issue 1558)', () => {
  it('never signs through the dApp CIP-30 signTx route', () => {
    expect(tab).not.toContain('METHOD.signTx');
    expect(tab).not.toContain('sendToBackground(');
    expect(dialog).not.toContain('METHOD.signTx');
  });

  it('hands the Nexus-built transaction to the in-wallet signing dialog', () => {
    expect(tab).toContain('collateralTx.value = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).toCore();');
    expect(tab).toMatch(/<SetCollateralDialog\s+:is-open="signDialogOpen"\s+:tx="collateralTx"/);
  });

  it('signs and submits with useTransactionSigning, covering password, PassKey and hardware wallets', () => {
    expect(dialog).toContain("import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';");
    expect(dialog).toContain("successMessageKey: 'settings.collateralTxSetSuccess'");
    expect(dialog).toContain('<TransactionAuthSection');
    expect(dialog).toContain('<KeystoneSignDialog');
  });
});
