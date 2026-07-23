export function validateAssembledUpdate(p: {
  witnessCount: number; expectedWitnessCount: number;
  vrf: string; expectedVrf: string;
  owners: string[]; expectedOwners: string[];
}): { ok: boolean; reason?: string } {
  if (p.witnessCount !== p.expectedWitnessCount) {
    return { ok: false, reason: `witness count ${p.witnessCount} != ${p.expectedWitnessCount}` };
  }
  if (p.vrf.toLowerCase() !== p.expectedVrf.toLowerCase()) {
    return { ok: false, reason: 'vrf hash does not match the on-chain value' };
  }
  const a = [...p.owners].sort().join(',');
  const b = [...p.expectedOwners].sort().join(',');
  if (a !== b) return { ok: false, reason: 'owners do not match the intended set' };
  return { ok: true };
}
