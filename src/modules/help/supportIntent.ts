import { reactive } from 'vue';
import { Blockchain, WalletType } from '@/models/types';

export type SupportNotice = 'noWallets' | 'locked' | 'syncing' | 'ineligible' | 'disabled' | 'eligible';
export interface HelpWallet {
  id?: number;
  chain?: string;
  network?: string;
  type?: string;
  stakeAddress?: string;
}

export function supportNoticeFor(input: {
  wallet: HelpWallet | null; locked: boolean; syncing: boolean;
  hasWallets: boolean; flagsReady: boolean; liveChat: boolean;
}): SupportNotice {
  if (!input.wallet || input.locked) return input.hasWallets || !!input.wallet ? 'locked' : 'noWallets';
  if (input.syncing) return 'syncing';
  if (input.wallet.chain !== Blockchain.CARDANO || input.wallet.type !== WalletType.Normal
    || !input.wallet.stakeAddress?.startsWith('stake1')) return 'ineligible';
  if (!input.flagsReady || !input.liveChat) return 'disabled';
  return 'eligible';
}

// Page-local intent only: no credentials, transcripts, or persisted preference.
export const helpSupportIntent = reactive({
  request: null as { articleId?: string; sequence: number } | null,
  dockRequest: null as { draft: string; walletId: number; sequence: number } | null,
  active: false,
});
let sequence = 0;
export function openSupport(articleId?: string): void {
  helpSupportIntent.request = { articleId, sequence: ++sequence };
}
export function openWalletSupport(draft: string, walletId: number): void {
  helpSupportIntent.active = true;
  helpSupportIntent.dockRequest = { draft, walletId, sequence: ++sequence };
}
export function clearHelpSupport(): void {
  helpSupportIntent.request = null;
  helpSupportIntent.dockRequest = null;
  helpSupportIntent.active = false;
}
