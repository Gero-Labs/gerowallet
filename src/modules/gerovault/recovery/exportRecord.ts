/**
 * When this device last exported a vault's recovery package, and which manifest revision it held,
 * for the staleness reminder (spec 6.8): a package made before the vault's latest revision misses
 * that revision, so the screen asks for a fresh export.
 *
 * Kept in the page's own `localStorage` (the extension origin, never `chrome.storage.local`): it
 * holds no secret, only a time, a version and a hash, and losing it only shows the reminder again.
 * The comparison follows `recoveryPackageStaleness` in the library.
 */
import type { VaultRecord } from '@/modules/gerovault/contracts';

export const RECOVERY_EXPORTS_STORAGE_KEY = 'gero.gerovault.recoveryExports.v1';

export interface RecoveryExportMark {
  /** Unix milliseconds. */
  readonly exportedAt: number;
  /** The manifest revision the package carried; null when the vault had none. */
  readonly manifestVersion: number | null;
  readonly manifestHash: string | null;
}

/**
 * - `NEVER_EXPORTED`: no export recorded on this device.
 * - `NO_MANIFEST`: the package had no manifest and the vault has one now.
 * - `OLDER_REVISION`: the vault has a newer revision than the package.
 * - `OTHER_REVISION`: the same version, other bytes.
 */
export type RecoveryExportStaleness =
  | { readonly stale: false; readonly exportedAt: number }
  | { readonly stale: true; readonly reason: 'NEVER_EXPORTED' }
  | { readonly stale: true; readonly reason: 'NO_MANIFEST' | 'OLDER_REVISION' | 'OTHER_REVISION'; readonly exportedAt: number };

const keyOf = (walletId: number, vaultId: string) => `${walletId}:${vaultId}`;

function readAll(): Record<string, RecoveryExportMark> {
  try {
    const raw = localStorage.getItem(RECOVERY_EXPORTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, RecoveryExportMark>) : {};
  } catch {
    return {};
  }
}

function wellFormed(mark: unknown): mark is RecoveryExportMark {
  const m = mark as Partial<RecoveryExportMark> | null;
  return Boolean(m) && typeof m === 'object'
    && Number.isSafeInteger(m?.exportedAt)
    && (m?.manifestVersion === null || Number.isSafeInteger(m?.manifestVersion))
    && (m?.manifestHash === null || typeof m?.manifestHash === 'string');
}

export function readRecoveryExport(walletId: number, vaultId: string): RecoveryExportMark | undefined {
  const mark = readAll()[keyOf(walletId, vaultId)];
  return wellFormed(mark) ? mark : undefined;
}

export function recordRecoveryExport(walletId: number, record: Pick<VaultRecord, 'vaultId' | 'manifest'>, exportedAt: number): RecoveryExportMark {
  const mark: RecoveryExportMark = {
    exportedAt,
    manifestVersion: record.manifest ? record.manifest.version : null,
    manifestHash: record.manifest ? record.manifest.hash : null,
  };
  try {
    const all = readAll();
    all[keyOf(walletId, record.vaultId)] = mark;
    localStorage.setItem(RECOVERY_EXPORTS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the reminder simply shows again next time.
  }
  return mark;
}

/** Whether to remind the participant to export again. */
export function recoveryExportStaleness(mark: RecoveryExportMark | undefined, record: Pick<VaultRecord, 'manifest'>): RecoveryExportStaleness {
  if (!mark) return { stale: true, reason: 'NEVER_EXPORTED' };
  const latest = record.manifest;
  if (!latest) return { stale: false, exportedAt: mark.exportedAt };
  if (mark.manifestVersion === null) return { stale: true, reason: 'NO_MANIFEST', exportedAt: mark.exportedAt };
  if (mark.manifestVersion < latest.version) return { stale: true, reason: 'OLDER_REVISION', exportedAt: mark.exportedAt };
  if (mark.manifestVersion === latest.version && mark.manifestHash !== latest.hash) {
    return { stale: true, reason: 'OTHER_REVISION', exportedAt: mark.exportedAt };
  }
  return { stale: false, exportedAt: mark.exportedAt };
}

/** The file name a package is saved under: no vault name or label, only the start of its id. */
export function recoveryFileName(vaultId: string): string {
  return `gero-vault-recovery-${vaultId.slice(0, 8)}.gvr`;
}

/** Hands the file to the browser's download. */
export function downloadRecoveryFile(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
