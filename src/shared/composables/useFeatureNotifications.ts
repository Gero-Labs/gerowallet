// Note: ref, computed are auto-imported globally by unplugin-auto-import

/**
 * Feature Notification System
 *
 * Tracks new features and shows badges/dots until user interacts with them.
 * Hierarchical structure: Feature -> Tab/Page -> Dialog/Menu -> Icon
 *
 * Usage:
 * 1. Define features with their version and path
 * 2. Check if feature is new with isFeatureNew()
 * 3. Mark feature as seen when user interacts with markFeatureAsSeen()
 * 4. Use computed properties to check if parent levels should show indicators
 */

// Current app version - update this when releasing new features
const APP_VERSION = '2.7.0';

// Feature definitions - add new features here
export interface FeatureDefinition {
  id: string;           // Unique feature ID (e.g., 'settings.security.passKey' or 'navigation.governance')
  version: string;      // Version when feature was added
  path: string[];       // Path hierarchy (e.g., ['settings', 'security', 'passKey'] or ['navigation', 'governance'])
}

// Define all trackable features
const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  // Settings > Security > Lock Settings
  {
    id: 'settings.security.lockSettings',
    version: '2.6.2',
    path: ['settings', 'security', 'lockSettings']
  },
  // Settings > Profile > German Language
  {
    id: 'settings.profile.germanLanguage',
    version: '2.6.3',
    path: ['settings', 'profile', 'germanLanguage']
  },
  // Navigation > Governance (example of new page in navigation menu)
  // {
  //   id: 'navigation.governance',
  //   version: '2.6.0',
  //   path: ['navigation', 'governance']
  // },
  // Navigation > Pool Operator (SPO Management)
  {
    id: 'navigation.poolOperator',
    version: '2.7.0',
    path: ['navigation', 'poolOperator']
  },
  // Navigation > Market page
  {
    id: 'navigation.market',
    version: '2.7.0',
    path: ['navigation', 'market']
  },
  // Settings > Advanced > Default Extension Mode (Full/Mini Gero toggle)
  {
    id: 'settings.advanced.defaultExtensionMode',
    version: '2.7.0',
    path: ['settings', 'advanced', 'defaultExtensionMode']
  },
  // Transactions > UTxOs tab
  {
    id: 'transactions.utxos',
    version: '2.7.0',
    path: ['transactions', 'utxos']
  },
  // Settings > Profile > Profile Picture (upload / NFT picker)
  {
    id: 'settings.profile.profilePicture',
    version: '2.7.0',
    path: ['settings', 'profile', 'profilePicture']
  },
  // Add more features here as needed
];

// Storage key for persisting seen features
const STORAGE_KEY = 'gero_feature_notifications';

// Interface for stored data
interface FeatureNotificationStorage {
  version: string;
  seenFeatures: Record<string, boolean>; // featureId -> seen status
  lastUpdated: string;
}

// Load seen features from localStorage
function loadSeenFeatures(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let seen: Record<string, boolean> = {};

    if (stored) {
      const data: FeatureNotificationStorage = JSON.parse(stored);
      if (data.version === APP_VERSION) {
        return data.seenFeatures || {};
      }
      // Version changed — carry over previously seen features
      seen = data.seenFeatures || {};
    }

    // Auto-mark features from older versions as seen (only current-version features should show as new)
    for (const feature of FEATURE_DEFINITIONS) {
      if (feature.version !== APP_VERSION && !seen[feature.id]) {
        seen[feature.id] = true;
      }
    }

    // Persist immediately so the upgrade logic only runs once
    saveSeenFeatures(seen);
    return seen;
  } catch (error) {
    console.error('Error loading feature notifications:', error);
    return {};
  }
}

// Save seen features to localStorage
function saveSeenFeatures(seenFeatures: Record<string, boolean>) {
  try {
    const data: FeatureNotificationStorage = {
      version: APP_VERSION,
      seenFeatures,
      lastUpdated: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving feature notifications:', error);
  }
}

// Reactive state
const seenFeatures = ref<Record<string, boolean>>(loadSeenFeatures());

/**
 * Check if a feature is new (not seen by user)
 */
export function isFeatureNew(featureId: string): boolean {
  const feature = FEATURE_DEFINITIONS.find(f => f.id === featureId);
  if (!feature) return false;

  // Feature is new only if:
  // 1. It was added in the current version
  // 2. It hasn't been marked as seen
  if (feature.version !== APP_VERSION) return false;
  return !seenFeatures.value[featureId];
}

/**
 * Mark a feature as seen (user interacted with it)
 */
export function markFeatureAsSeen(featureId: string) {
  const feature = FEATURE_DEFINITIONS.find(f => f.id === featureId);
  if (!feature) {
    console.warn(`Feature not found: ${featureId}`);
    return;
  }

  // Create a new object to trigger Vue 2 reactivity
  seenFeatures.value = {
    ...seenFeatures.value,
    [featureId]: true
  };
  saveSeenFeatures(seenFeatures.value);

  console.log(`✓ Feature marked as seen: ${featureId}`);
}

/**
 * Check if any features in a specific path are new
 * Example: hasNewFeaturesInPath(['settings', 'security']) checks if any security features are new
 */
export function hasNewFeaturesInPath(path: string[]): boolean {
  return FEATURE_DEFINITIONS.some(feature => {
    // Check if feature path starts with the given path
    const pathMatches = path.every((segment, index) => feature.path[index] === segment);
    if (!pathMatches) return false;

    // Check if feature is new
    return isFeatureNew(feature.id);
  });
}

/**
 * Get count of new features in a specific path
 */
export function getNewFeatureCount(path: string[]): number {
  return FEATURE_DEFINITIONS.filter(feature => {
    const pathMatches = path.every((segment, index) => feature.path[index] === segment);
    return pathMatches && isFeatureNew(feature.id);
  }).length;
}

/**
 * Get all features in a specific path
 */
export function getFeaturesInPath(path: string[]): FeatureDefinition[] {
  return FEATURE_DEFINITIONS.filter(feature => {
    return path.every((segment, index) => feature.path[index] === segment);
  });
}

/**
 * Get all new (unseen) features in a specific path
 */
export function getNewFeaturesInPath(path: string[]): FeatureDefinition[] {
  return getFeaturesInPath(path).filter(feature => isFeatureNew(feature.id));
}

/**
 * Reset all feature notifications (for debugging)
 */
export function resetAllFeatureNotifications() {
  seenFeatures.value = {};
  saveSeenFeatures(seenFeatures.value);
  console.log('🔄 All feature notifications reset');
}

/**
 * Export reactive computed for checking new features
 */
export function useFeatureNotifications() {
  return {
    isFeatureNew: computed(() => isFeatureNew),
    markFeatureAsSeen,
    hasNewFeaturesInPath: computed(() => hasNewFeaturesInPath),
    getNewFeatureCount: computed(() => getNewFeatureCount),
    getFeaturesInPath: computed(() => getFeaturesInPath),
    getNewFeaturesInPath: computed(() => getNewFeaturesInPath),
    resetAllFeatureNotifications,
    seenFeatures: computed(() => seenFeatures.value),
  };
}
