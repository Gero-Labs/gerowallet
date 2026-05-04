import { ref, computed } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type { Position, ClosedPosition } from '@/api/strike-v2.types';

// Singleton state
const positions = ref<Position[]>([]);
const closedPositions = ref<ClosedPosition[]>([]);
const loadingOpen = ref(false);
const loadingClosed = ref(false);

// Computed
const openPositionCount = computed(() => positions.value.length);

const totalUnrealizedPnl = computed(() =>
  positions.value.reduce((sum, p) => sum + parseFloat(p.upnl ?? '0'), 0)
);

// Methods
async function loadPositions(symbol?: string): Promise<void> {
  loadingOpen.value = true;
  try {
    const result = await strikeUserApi.getPositions(symbol);
    positions.value = result?.positions ?? (Array.isArray(result) ? result : []);
  } finally {
    loadingOpen.value = false;
  }
}

async function loadClosedPositions(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
} = {}): Promise<void> {
  loadingClosed.value = true;
  try {
    const result = await strikeUserApi.getClosedPositions(params);
    closedPositions.value = result?.positions ?? (Array.isArray(result) ? result : []);
  } finally {
    loadingClosed.value = false;
  }
}

function getPositionBySymbol(symbol: string): Position | undefined {
  return positions.value.find((p) => p.symbol === symbol);
}

export function useStrikePositions() {
  return {
    // State
    positions,
    closedPositions,
    loadingOpen,
    loadingClosed,
    // Computed
    openPositionCount,
    totalUnrealizedPnl,
    // Methods
    loadPositions,
    loadClosedPositions,
    getPositionBySymbol,
  };
}
