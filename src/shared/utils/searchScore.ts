/**
 * Relevance scoring for the global search bar.
 *
 * Lives here rather than inside `useGlobalSearch` so every source ranks on the
 * SAME scale. A source that scored on its own curve would float or sink as a
 * block regardless of how well it matched, because `GlobalSearch.vue` orders
 * groups by their top-scoring row.
 */

/**
 * Relevance of `text` for `query`: exact match > starts-with > whole-word >
 * word-prefix > substring. `query` is expected already lowercased and trimmed;
 * 0 means "no match" and the row is dropped.
 */
export function scoreMatch(text: string | null | undefined, query: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t === query) return 100;           // exact match
  if (t.startsWith(query)) return 80;    // starts with query
  const words = t.split(/[\s\-_]+/);
  if (words.some(w => w === query)) return 70;  // exact word match
  if (words.some(w => w.startsWith(query))) return 60; // word starts with
  if (t.includes(query)) return 30;      // substring
  return 0;
}
