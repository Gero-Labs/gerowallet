// src/services/agent/allowanceIntent.ts

export interface AllowanceIntent {
  type: 'allowance';
}

/**
 * Matches phrases the user types to open the agent allowance management card.
 * Examples: "set up an agent allowance", "agent allowance", "show my allowance",
 * "spending allowance".
 */
const ALLOWANCE_RE =
  /\b(?:set\s+up\s+(?:an?\s+)?agent\s+allowance|agent\s+allowance|show(?:\s+my)?\s+allowance|spending\s+allowance)\b/i;

export function parseAllowanceIntent(text: string): AllowanceIntent | null {
  if (ALLOWANCE_RE.test(text || '')) return { type: 'allowance' };
  return null;
}
