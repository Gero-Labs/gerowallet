/**
 * Saving and opening signing files. Both are small UTF-8 JSON files the user moves by hand
 * between devices; nothing here sends them anywhere.
 */

/** Offers `text` as a file download named `fileName`. */
export function saveTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.click();
  // Revoke after the click has been handled, so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Reads a chosen file as text, refusing anything larger than `maxBytes` before reading it. */
export async function readTextFile(file: File, maxBytes: number): Promise<string | null> {
  if (!file || file.size > maxBytes) return null;
  return file.text();
}
