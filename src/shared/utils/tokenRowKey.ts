/**
 * Row key for a holdings row. A unit can appear twice — once spendable, once locked in a
 * CIP-113 UTxO — so the key carries the partition as well as the unit. Every surface that
 * renders holdings must agree on it, or the two rows collide and one is silently dropped.
 */
export function tokenRowKey(unit: string, isProgrammable?: boolean): string {
  return isProgrammable ? `${unit}#locked` : unit;
}
