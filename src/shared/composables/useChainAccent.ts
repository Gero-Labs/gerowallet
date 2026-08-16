import { watch, effectScope } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { chainAccents, chainKeyFor } from '@/config/themes';
import { updateVuetifyTheme } from '@/plugins/vuetify';

let applied = false;

/**
 * Writes a chain's accent slots as CSS custom properties on :root.
 * The single body shared by useChainAccent (post-login, keyed on
 * loggedWallet) and the welcome screen's pre-login network preview —
 * a new accent slot only ever needs adding here.
 */
export function applyChainAccent(chain: string | undefined | null): void {
  const a = chainAccents[chainKeyFor(chain)];
  const root = document.documentElement;
  root.style.setProperty('--g-accent', a.accent);
  root.style.setProperty('--g-grad-1', a.gradient1);
  root.style.setProperty('--g-grad-2', a.gradient2);
  // On-gradient text: only chains that override it (Midnight = bright white)
  // set the inline value; the rest fall back to the tokens.css default.
  if (a.onGrad) root.style.setProperty('--g-on-grad', a.onGrad);
  else root.style.removeProperty('--g-on-grad');
  // legacy aliases (do not add new consumers)
  root.style.setProperty('--chain-primary', a.accent);
  root.style.setProperty('--chain-gradient1', a.gradient1);
  root.style.setProperty('--chain-gradient2', a.gradient2);
}

/**
 * The ONE place a chain switch touches the UI. Writes the accent
 * slots as CSS custom properties and re-points the Vuetify theme.
 * Legacy --chain-* names are kept as aliases so the ~198 existing
 * var(--chain-primary/gradient1/gradient2) consumers keep working;
 * sweeps migrate them to --g-* opportunistically.
 *
 * Called once per page: from src/options/App.vue setup (dashboard) and
 * from useChainContext (sidepanel). The watcher lives in a DETACHED
 * effectScope so a caller unmounting can never dispose it (the module
 * latch would otherwise make this a permanent no-op for the page).
 */
export function useChainAccent(): void {
  if (applied || typeof document === 'undefined') return;
  applied = true;
  const scope = effectScope(true); // detached: immune to caller lifetime
  scope.run(() => {
    watch(
      () => walletStore.loggedWallet?.chain,
      (chain) => {
        applyChainAccent(chain);
        updateVuetifyTheme(chain ?? 'Cardano');
      },
      { immediate: true },
    );
  });
}
