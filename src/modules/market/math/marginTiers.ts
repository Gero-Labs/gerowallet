/**
 * Margin tier helpers for Strike Finance perpetuals.
 *
 * Each market exposes a list of margin tiers sorted ascending by `max_notional`.
 * Larger positions land in more restrictive tiers (lower max leverage,
 * higher maintenance margin rate). All tier numeric fields arrive from the
 * API as string-encoded decimals (`MarginTier`); this module re-uses a
 * normalised numeric shape (`MarginTierNumeric`) for fast in-form math.
 *
 * Spec reference:
 *   strike-finance-skills/skills/strike-calculations/SKILL.md (Margin Tiers).
 */

import type { MarginTier, MarginTierNumeric } from '@/api/strike-v2.types';

/**
 * Convert API string-decoded margin tiers to the numeric form used by the
 * math layer. Cheap enough to call inline; callers may also memoise per
 * market.
 */
export function normalizeMarginTiers(tiers: MarginTier[]): MarginTierNumeric[] {
  return tiers.map((t) => ({
    max_notional: parseFloat(t.max_notional),
    max_leverage: t.max_leverage,
    maintenance_margin_rate: parseFloat(t.maintenance_margin_rate),
    maintenance_amount: parseFloat(t.maintenance_amount),
  }));
}

/**
 * Resolve the margin tier that applies to a given notional value.
 *
 * Returns the first tier where `notional <= max_notional`. If the position
 * exceeds every tier (which the exchange would normally reject), the most
 * restrictive (last) tier is returned so downstream math degrades safely.
 */
export function getMarginTier(
  tiers: MarginTierNumeric[],
  notional: number,
): MarginTierNumeric | null {
  if (!tiers || tiers.length === 0) return null;
  for (const tier of tiers) {
    if (notional <= tier.max_notional) return tier;
  }
  return tiers[tiers.length - 1];
}

/**
 * Maximum leverage available for a given notional. Falls back to the
 * highest tier's leverage cap when no tier matches.
 */
export function getMaxLeverageForNotional(
  tiers: MarginTierNumeric[],
  notional: number,
): number {
  const tier = getMarginTier(tiers, notional);
  return tier?.max_leverage ?? 0;
}
