/**
 * Row key for a holdings row. A unit can appear more than once — spendable, locked in a
 * CIP-113 UTxO, and (for ADA) held in the wallet's own Gero listings — so the key carries the
 * partition as well as the unit. Every surface that renders holdings must agree on it, or the
 * rows collide and one is silently dropped.
 */
export function tokenRowKey(unit: string, isProgrammable?: boolean, isListed?: boolean): string {
  if (isProgrammable) return `${unit}#locked`;
  return isListed ? `${unit}#listed` : unit;
}
