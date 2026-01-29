/**
 * Global debug logging utility
 * Controls console output based on environment variables
 */

// Check if debug mode is enabled via environment variable
// Set VITE_DEBUG_STORES=true in .env file to enable debug logging
// @ts-ignore
const isDebugEnabled = import.meta.env.VITE_DEBUG_STORES === 'true';

/**
 * Conditional debug logger that respects the global debug flag
 * Binds directly to console.log to preserve source location in Chrome DevTools
 * @param args - Arguments to pass to console.log
 */
export const debugLog: (...args: any[]) => void = isDebugEnabled
  ? console.log.bind(console)
  : () => {};

/**
 * Conditional warning logger for development mode
 * @param args - Arguments to pass to console.warn
 */
export const debugWarn: (...args: any[]) => void = isDebugEnabled
  ? console.warn.bind(console)
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
