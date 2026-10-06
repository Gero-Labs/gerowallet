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
/**
 * Lowercase and drop diacritics, so "configuracion" finds "Configuración" and
 * "contrasena" finds "contraseña". Spanish users often type without accents.
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

export function scoreMatch(text: string | null | undefined, rawQuery: string): number {
  if (!text) return 0;
  const t = foldForSearch(text);
  const query = foldForSearch(rawQuery);
  if (t === query) return 100;           // exact match
  if (t.startsWith(query)) return 80;    // starts with query
  const words = t.split(/[\s\-_]+/);
  if (words.some(w => w === query)) return 70;  // exact word match
  if (words.some(w => w.startsWith(query))) return 60; // word starts with
  if (t.includes(query)) return 30;      // substring
  return 0;
}

/**
 * Relevance of a static index entry (a setting, a page or an action) for
 * `query`: the best of its keywords (exact 100, keyword-prefix 90,
 * keyword-substring 50) or its resolved title on the `scoreMatch` curve.
 *
 * One curve for every static index, so a page and a setting typed for with
 * the same intent rank against each other honestly. Keywords carry EN, DE and
 * ES terms; both sides are accent-folded.
 */
export function scoreIndexEntry(keywords: readonly string[], title: string, rawQuery: string): number {
  const query = foldForSearch(rawQuery.trim());
  if (!query) return 0;
  let best = 0;
  for (const keyword of keywords) {
    const kw = foldForSearch(keyword);
    if (kw === query) return 100;
    if (kw.startsWith(query)) best = Math.max(best, 90);
    else if (kw.includes(query)) best = Math.max(best, 50);
  }
  return Math.max(best, scoreMatch(title, query));
}
