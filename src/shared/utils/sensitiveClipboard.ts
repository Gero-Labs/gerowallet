/** How long a copied secret (2FA backup codes) may stay on the clipboard. */
export const SENSITIVE_CLIPBOARD_CLEAR_MS = 60_000;

/**
 * Copy a secret to the clipboard and clear it again after `clearAfterMs`, but
 * only if the clipboard still holds that secret: anything the user copied in
 * the meantime is left alone. Reading the clipboard back uses the extension's
 * `clipboardRead` permission; if the page has closed or lost focus by then,
 * the clear is skipped.
 */
export async function copySensitiveText(text: string, clearAfterMs = SENSITIVE_CLIPBOARD_CLEAR_MS): Promise<void> {
  await navigator.clipboard.writeText(text);
  setTimeout(() => { void clearIfUnchanged(text); }, clearAfterMs);
}

async function clearIfUnchanged(text: string): Promise<void> {
  try {
    if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('');
  } catch {
    // Page closed or unfocused: nothing more can be done from here.
  }
}
