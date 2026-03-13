/**
 * Returns two-letter initials from a name.
 * Multi-word: first letter of first two words (e.g. "Best Buy" → "BB").
 * Single-word: first two characters (e.g. "Amazon" → "AM").
 */
export const getInitials = (name: string): string => {
  if (!name) return '??';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};
