/**
 * Global debug logging utility
 * Controls console.debug output based on environment variable
 */

// Check if debug mode is enabled via environment variable
// @ts-ignore
const isDebugEnabled = import.meta.env.VITE_DEBUG_STORES === 'true';

/**
 * Conditional debug logger that respects the global debug flag
 * Binds directly to console.log to preserve source location in Chrome DevTools
 * @param args - Arguments to pass to console.log
 */
export const debugLog: (...args: any[]) => void = isDebugEnabled
  ? console.debug.bind(console)
  : () => {};

/**
 * Check if debug mode is currently enabled
 * @returns true if debug logging is enabled
 */
export function isDebugMode(): boolean {
  return isDebugEnabled;
}

/**
 * Export the debug flag for direct usage
 */
export const DEBUG_ENABLED = isDebugEnabled;
