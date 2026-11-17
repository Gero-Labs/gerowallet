/** One file an NFT's detail can show: a single source string and its media type. */
export interface AssetFile { src: string; mediaType: string }

/**
 * A CIP-25 source as one string. Metadata strings are capped at 64 bytes, so a longer source (an
 * inline data URI, a long URL) comes as an array of chunks. Anything else is not a source.
 */
function sourceOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((part) => typeof part === 'string')) return raw.join('') || null;
  return null;
}

/** The files of an NFT's metadata, main `image` first, then `files` not already listed. */
export function assetFilesOf(metadata: { image?: unknown; mediaType?: unknown; files?: unknown } | null | undefined): AssetFile[] {
  const out: AssetFile[] = [];
  if (!metadata) return out;
  const image = sourceOf(metadata.image);
  if (image) out.push({ src: image, mediaType: typeof metadata.mediaType === 'string' ? metadata.mediaType : '' });
  if (Array.isArray(metadata.files)) {
    for (const file of metadata.files as { src?: unknown; mediaType?: unknown }[]) {
      const src = sourceOf(file?.src);
      if (src && !out.some((f) => f.src === src)) out.push({ src, mediaType: typeof file.mediaType === 'string' ? file.mediaType : '' });
    }
  }
  return out;
}

const IMAGE_TYPES = new Set(['', 'image/svg+xml', 'image/png', 'image/webp', 'image/jpeg', 'image/gif']);

/**
 * Whether a file is shown as an image. An SVG is drawn through an <img>, where its scripts do not
 * run, so it is as safe to show as a PNG.
 */
export function isImageMediaType(mediaType: string): boolean {
  return IMAGE_TYPES.has(mediaType);
}
