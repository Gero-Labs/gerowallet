/**
 * Determines the appropriate timeframe for API calls based on how long data has been expired
 * Strategy: The longer data is expired, the larger timeframe we need to fetch
 */
export function getTimeframeBasedOnExpiry(expiresAt: number): string {
  const now = Date.now();
  const timeSinceExpiry = now - expiresAt;
  
  // Convert to days
  const daysSinceExpiry = timeSinceExpiry / (1000 * 60 * 60 * 24);
  
  // Map expiry time to timeframe
  if (daysSinceExpiry <= 1) {
    return '24h';
  } else if (daysSinceExpiry <= 7) {
    return '7d';
  } else if (daysSinceExpiry <= 30) {
    return '30d';
  } else if (daysSinceExpiry <= 90) {
    return '90d';
  } else if (daysSinceExpiry <= 180) {
    return '180d';
  } else if (daysSinceExpiry <= 365) {
    return '1y';
  } else {
    return 'all';
  }
}

/**
 * Available API timeframes in order from smallest to largest
 */
export const AVAILABLE_TIMEFRAMES = ['24h', '7d', '30d', '90d', '180d', '1y', 'all'] as const;

export type TimeframeType = typeof AVAILABLE_TIMEFRAMES[number]; 