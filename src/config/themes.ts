// Chain accent palettes: a chain switch changes ONLY these slots.
// Surfaces, text tones and semantic colors live in tokens.css and never
// change per chain.
export type ChainKey = 'cardano' | 'bitcoin' | 'apex' | 'midnight';

export interface ChainAccent {
  /** Flat accent: links, icons, active tab text, focus ring */
  accent: string;
  /** Gradient stops: primary CTA, active nav indicator, chain dot, header hairline */
  gradient1: string;
  gradient2: string;
  /** Text/icon color ON the gradient CTA. Omit to inherit the global
   *  --g-on-grad (#06181B). Midnight overrides it to pure black. */
  onGrad?: string;
}

export const chainAccents: Record<ChainKey, ChainAccent> = {
  cardano: { accent: '#33C7DD', gradient1: '#00DFF3', gradient2: '#00FAD5' },
  bitcoin: { accent: '#F7931A', gradient1: '#F7931A', gradient2: '#FFB84D' },
  apex: { accent: '#E06030', gradient1: '#E06030', gradient2: '#F08040' },
  // Midnight: black-and-white base with a moonlit-purple accent. Bright violet
  // for flat use (icons/links/active), a lavender->violet gradient for CTAs,
  // and PURE BLACK text on those purple buttons (onGrad) — never white.
  midnight: { accent: '#A78BFA', gradient1: '#C4B5FD', gradient2: '#9D7BEA', onGrad: '#000000' },
};

/** Blockchain display-string -> ChainKey (walletStore.loggedWallet.chain values) */
export function chainKeyFor(chain: string | undefined | null): ChainKey {
  switch (chain) {
    case 'Bitcoin':
      return 'bitcoin';
    case 'Apex Fusion Prime':
    case 'Apex Fusion Vector':
      return 'apex';
    case 'Midnight':
      return 'midnight';
    default:
      return 'cardano';
  }
}

// ---- Legacy shape kept for the transition (consumers: useChainContext
// themeColors bindings, PortfolioChart, ContentLayout). Values re-pointed
// to the accent system so every consumer converges on the same colors.
// Sweeps replace `themes.X.primary` reads with `var(--g-accent)`; delete
// this block when `rg "from '@/config/themes'"` shows only vuetify.ts +
// useChainAccent.ts remaining.
const legacy = (a: ChainAccent) => ({
  primary: a.accent,
  secondary: a.gradient2,
  accent: a.accent,
  light: a.gradient1,
  dark: a.accent,
  darker: a.accent,
  muted: a.accent,
  bright: a.gradient1,
  gradient1: a.gradient1,
  gradient2: a.gradient2,
});

export const themes = {
  cardano: legacy(chainAccents.cardano),
  apex: legacy(chainAccents.apex),
  bitcoin: legacy(chainAccents.bitcoin),
  midnight: legacy(chainAccents.midnight),
};

// iconFilters is DELETED, not rewritten: its only writer (--icon-filter in
// ContentLayout) had zero var() readers, and the plan's direction is
// currentColor icons. If this rewrite breaks an import, that import site was
// consuming dead code; remove it.
