/* eslint-disable @typescript-eslint/no-explicit-any -- page-world Wallet Standard shim: implements the untyped @wallet-standard interfaces against window events */
// Solana dApp connection (phase 1): Gero as a Wallet Standard wallet, which is how Solana
// dApps (@solana/wallet-adapter, @solana/react) list wallets. It never touches
// `window.solana`, so it does not compete with Phantom for that global.
//
// Registered only when the background says the `isSolanaEnabled` flag is on: a page script
// cannot read feature flags, so it asks once at load.
//
// Features: standard:connect / disconnect / events and solana:signMessage. solana:signTransaction
// is listed because the wallet adapter only shows wallets that have it (or
// signAndSendTransaction); until transaction signing lands it refuses every call.
import { base58Decode } from '@/chains/solana/solanaBase58';
import {
  SolanaDappErrorCode,
  solanaDappError,
  toSolanaPageError,
  type SolanaDappErrorCodeValue,
} from '@/chains/solana/solanaDappProtocol';
import { GERO_CARDANO_ICON } from './injectIcon';
import * as bridge from './solanaWebpage';

const CHAINS = ['solana:mainnet', 'solana:devnet'] as const;
const ACCOUNT_FEATURES = ['solana:signMessage', 'solana:signTransaction'] as const;

const ICON = (() => {
  try {
    const svg = decodeURIComponent(GERO_CARDANO_ICON.slice('data:image/svg+xml,'.length));
    return `data:image/svg+xml;base64,${btoa(svg)}` as const;
  } catch {
    return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzE0RjE5NSIvPjwvc3ZnPg==' as const;
  }
})();

let accounts: ReadonlyArray<any> = [];
const changeListeners = new Set<(properties: { accounts?: ReadonlyArray<any> }) => void>();

function setAccounts(next: ReadonlyArray<any>): void {
  accounts = next;
  changeListeners.forEach((listener) => {
    try { listener({ accounts }); } catch { /* a dApp's listener must not break the wallet */ }
  });
}

function toAccount(address: string, chain: string): any {
  return Object.freeze({
    address,
    publicKey: base58Decode(address),
    chains: Object.freeze([chain]),
    features: ACCOUNT_FEATURES,
  });
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Already an Error from the relay (toSolanaPageError); anything else gets the same shape.
    throw error instanceof Error ? error : toSolanaPageError(error);
  }
}

function refuse(code: SolanaDappErrorCodeValue, message: string): never {
  throw toSolanaPageError(solanaDappError(code, message));
}

export const geroSolanaWallet = Object.freeze({
  version: '1.0.0' as const,
  name: 'Gero',
  icon: ICON,
  chains: CHAINS,
  get accounts() { return accounts; },
  features: Object.freeze({
    'standard:connect': Object.freeze({
      version: '1.0.0' as const,
      connect: (input?: { silent?: boolean }) => call(async () => {
        const account = await bridge.solanaConnect(input?.silent === true);
        setAccounts([toAccount(account.address, account.chain)]);
        return { accounts };
      }),
    }),
    'standard:disconnect': Object.freeze({
      version: '1.0.0' as const,
      // The dApp forgets the wallet; the site stays connected in Gero (Settings > Connected sites).
      disconnect: async () => { setAccounts([]); },
    }),
    // 'change' fires for this page's own connect and disconnect only. An account switch in Gero
    // is not reported yet: the dApp keeps the old account, its signMessage is then refused with
    // 4100, and it has to connect again.
    'standard:events': Object.freeze({
      version: '1.0.0' as const,
      on: (event: string, listener: (properties: { accounts?: ReadonlyArray<any> }) => void) => {
        if (event !== 'change') return () => undefined;
        changeListeners.add(listener);
        return () => { changeListeners.delete(listener); };
      },
    }),
    'solana:signMessage': Object.freeze({
      version: '1.1.0' as const,
      signatureTypes: Object.freeze(['ed25519'] as const),
      signMessage: (...inputs: Array<{ account: { address: string }; message: Uint8Array }>) => call(async () => {
        const outputs: Array<{ signedMessage: Uint8Array; signature: Uint8Array; signatureType: 'ed25519' }> = [];
        for (const input of inputs) {
          const address = input?.account?.address;
          if (!accounts.some((a) => a.address === address)) {
            refuse(SolanaDappErrorCode.Unauthorized, 'That account is not connected');
          }
          if (!(input.message instanceof Uint8Array)) refuse(SolanaDappErrorCode.InvalidParams, 'message must be a Uint8Array');
          const message = new Uint8Array(input.message);
          const signature = await bridge.solanaSignMessage(address, message);
          outputs.push({ signedMessage: message, signature, signatureType: 'ed25519' });
        }
        return outputs;
      }),
    }),
    'solana:signTransaction': Object.freeze({
      version: '1.0.0' as const,
      supportedTransactionVersions: Object.freeze(['legacy', 0] as const),
      signTransaction: async () => refuse(SolanaDappErrorCode.Unsupported, "Gero can't sign Solana transactions for dApps yet"),
    }),
  }),
});

/** Registers with the Wallet Standard registry: now, and for apps that load after us. */
export function registerGeroSolanaWallet(target: Window = window): void {
  const callback = (api: { register: (wallet: unknown) => unknown }) => api.register(geroSolanaWallet);
  try {
    target.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      bubbles: false, cancelable: false, composed: false, detail: callback,
    }));
  } catch (e) {
    console.error('[Gero] wallet-standard:register-wallet', e);
  }
  try {
    target.addEventListener('wallet-standard:app-ready', (event: Event) => {
      try { callback((event as CustomEvent).detail); } catch (e) { console.error('[Gero] wallet-standard:app-ready', e); }
    });
  } catch (e) {
    console.error('[Gero] wallet-standard:app-ready', e);
  }
}

/** Registers once the background confirms Solana is on; quietly does nothing otherwise. */
export async function installGeroSolanaWallet(target: Window = window): Promise<boolean> {
  try {
    if (!(await bridge.solanaAvailable())) return false;
  } catch {
    return false;
  }
  registerGeroSolanaWallet(target);
  return true;
}

// Side effect on import (inject.ts), as injectMidnight.ts does.
if (typeof window !== 'undefined') void installGeroSolanaWallet();
