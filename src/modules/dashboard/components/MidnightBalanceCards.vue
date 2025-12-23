<template>
  <v-container fluid class="pa-0">
    <v-row no-gutters>
      <!-- DUST Balance -->
      <v-col cols="12" md="6" lg="4" class="pa-2">
        <v-card
          outlined
          class="liquid-glass midnight-balance-card"
          elevation="0"
        >
          <v-card-text class="pa-4">
            <v-row no-gutters>
              <!-- Left: DUST Balance -->
              <v-col cols="5" class="pr-2">
                <div class="d-flex align-center mb-2">
                  <v-icon color="amber lighten-2" class="mr-1" small>mdi-star</v-icon>
                  <span class="text-caption text--secondary">Balance</span>
                  <v-spacer></v-spacer>
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-icon x-small color="grey" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
                    </template>
                    <span>DUST tokens available for transaction fees (non-transferable)</span>
                  </v-tooltip>
                </div>
                <div class="balance-amount dust-amount">
                  {{ formatDust(balances.dust) }}
                </div>
                <div class="balance-currency">tDUST</div>
                <div class="dust-info text--secondary mt-2" style="font-size: 0.65rem;">
                  For fees only
                </div>
              </v-col>

              <!-- Divider -->
              <v-divider vertical class="mx-2"></v-divider>

              <!-- Right: Generation Progress -->
              <v-col cols="6" class="pl-2">
                <div class="d-flex align-center mb-2">
                  <v-icon color="cyan lighten-2" class="mr-1" small>mdi-progress-clock</v-icon>
                  <span class="text-caption text--secondary">Generating</span>
                </div>
                <div class="dust-generation-stats-compact">
                  <!-- Dust particles animation -->
                  <div class="dust-particles">
                    <span class="dust-particle" v-for="(style, i) in particleStyles" :key="i" :style="style"></span>
                  </div>

                  <div class="generating-amount-compact mb-1" style="position: relative; z-index: 1;">
                    {{ formatDust(dustGeneratingLive) }}
                  </div>
                  <div class="text-caption text--secondary mb-2" style="position: relative; z-index: 1;">tDUST</div>

                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-progress-linear
                        :value="dustProgress"
                        height="4"
                        rounded
                        class="dust-progress-gradient"
                        style="position: relative; z-index: 1;"
                        v-bind="attrs"
                        v-on="on"
                      ></v-progress-linear>
                    </template>
                    <span>{{ dustProgress.toFixed(1) }}% of max ({{ formatDust(maxDust) }} tDUST) • {{ dustGenerationRate }} DUST/day per NIGHT</span>
                  </v-tooltip>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Combined NIGHT Balances Card -->
      <v-col cols="12" md="12" lg="8" class="pa-2">
        <v-card
          outlined
          class="liquid-glass midnight-balance-card"
          elevation="0"
        >
          <v-card-text class="pa-4">
            <v-row no-gutters>
              <!-- NIGHT Shielded -->
              <v-col cols="12" md="4" class="pr-md-3 mb-4 mb-md-0">
                <div class="d-flex align-center mb-2">
                  <v-icon color="purple lighten-2" class="mr-2" small>mdi-shield-lock</v-icon>
                  <span class="text-caption text--secondary">Shielded</span>
                  <v-spacer></v-spacer>
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-icon x-small color="grey" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
                    </template>
                    <span>Private NIGHT tokens in shielded pool</span>
                  </v-tooltip>
                </div>
                <div class="balance-amount">
                  {{ formatNight(balances.nightShielded) }}
                </div>
                <div class="balance-currency">tNIGHT</div>
                <div class="balance-fiat text--secondary mt-1" style="font-size: 0.75rem;">
                  ≈ ${{ formatFiat(balances.nightShielded) }}
                </div>
              </v-col>

              <!-- Vertical Divider 1 -->
              <v-divider vertical class="d-none d-md-block"></v-divider>

              <!-- NIGHT Unshielded -->
              <v-col cols="12" md="4" class="px-md-3 mb-4 mb-md-0">
                <div class="d-flex align-center mb-2">
                  <v-icon color="blue lighten-2" class="mr-2" small>mdi-shield-off</v-icon>
                  <span class="text-caption text--secondary">Unshielded</span>
                  <v-spacer></v-spacer>
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-icon x-small color="grey" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
                    </template>
                    <span>Public NIGHT tokens in unshielded pool</span>
                  </v-tooltip>
                </div>
                <div class="balance-amount">
                  {{ formatNight(balances.nightUnshielded) }}
                </div>
                <div class="balance-currency">tNIGHT</div>
                <div class="balance-fiat text--secondary mt-1" style="font-size: 0.75rem;">
                  ≈ ${{ formatFiat(balances.nightUnshielded) }}
                </div>
              </v-col>

              <!-- Vertical Divider 2 -->
              <v-divider vertical class="d-none d-md-block"></v-divider>

              <!-- NIGHT Registered -->
              <v-col cols="12" md="4" class="pl-md-3">
                <div class="d-flex align-center mb-2">
                  <v-icon color="green lighten-2" class="mr-2" small>mdi-check-circle</v-icon>
                  <span class="text-caption text--secondary">Registered</span>
                  <v-spacer></v-spacer>
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-icon x-small color="grey" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
                    </template>
                    <span>NIGHT tokens registered for DUST generation</span>
                  </v-tooltip>
                </div>
                <div class="balance-amount">
                  {{ formatNight(balances.nightRegistered) }}
                </div>
                <div class="balance-currency">tNIGHT</div>
                <div class="balance-status d-flex align-center mt-1" style="font-size: 0.75rem;">
                  <v-icon x-small color="green" class="mr-1">mdi-chart-line</v-icon>
                  <span class="text--secondary">Generating DUST</span>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { getMockMidnightWalletData, formatNight as formatNightUtil, formatDust as formatDustUtil } from '@/utils/midnight-mock-data';

export default defineComponent({
  name: 'MidnightBalanceCards',

  data() {
    return {
      // Mock price for USD conversion
      nightPriceUsd: 0.25,
      // Load mock data directly for UI design
      mockData: getMockMidnightWalletData(),
      // Real-time DUST generation
      dustGeneratingLive: BigInt(0),
      generationInterval: null as any,
      // Pre-generated particle styles (prevents stuttering on updates)
      particleStyles: [] as Record<string, string>[],
    };
  },

  mounted() {
    // Initialize live DUST generation from mock data
    this.dustGeneratingLive = this.mockData.balances.dustGenerating;

    // Pre-generate particle styles to prevent stuttering on updates
    this.particleStyles = Array.from({ length: 20 }, (_, i) => this.generateParticleStyle(i));

    // Start real-time DUST generation
    this.startDustGeneration();
  },

  beforeDestroy() {
    // Clean up interval
    if (this.generationInterval) {
      clearInterval(this.generationInterval);
    }
  },

  computed: {
    balances() {
      return this.mockData.balances;
    },

    dustGenerationRate() {
      // Returns rate in DUST per day per NIGHT (e.g., 0.5)
      return this.mockData.metadata.dustGenerationRate;
    },

    dustGenerationPerDay() {
      // Total DUST generated per day based on registered NIGHT
      const nightAmount = Number(this.balances.nightRegistered) / 1e12;
      return nightAmount * this.dustGenerationRate;
    },

    maxDust() {
      // Maximum DUST = 50% of registered NIGHT
      if (this.balances.nightRegistered === BigInt(0)) return BigInt(0);
      return this.balances.nightRegistered / BigInt(2);
    },

    dustProgress() {
      // Calculate progress based on 50% cap (Maximum DUST = 50% of registered NIGHT)
      if (this.balances.nightRegistered === BigInt(0)) return 0;
      // Use live value for real-time updates
      return Number((this.dustGeneratingLive * BigInt(100)) / this.maxDust);
    },
  },

  methods: {
    formatNight(value: bigint): string {
      return formatNightUtil(value);
    },

    formatDust(value: bigint): string {
      return formatDustUtil(value);
    },

    formatFiat(value: bigint): string {
      const nightAmount = Number(value) / 1e12;
      const fiatValue = nightAmount * this.nightPriceUsd;
      return fiatValue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    },

    generateParticleStyle(index: number): Record<string, string> {
      // Generate random properties for each particle (called once in mounted)
      const top = Math.random() * 100; // Random vertical position
      const size = Math.random() * 2 + 0.5; // 0.5-2.5px (smaller, more dust-like)
      const duration = Math.random() * 6 + 4; // 4-10s (slower, floating)
      const delay = Math.random() * 3; // 0-3s delay
      const opacity = Math.random() * 0.4 + 0.1; // 0.1-0.5 opacity (more subtle)
      const yDrift = (Math.random() - 0.5) * 60; // -30 to +30px vertical drift

      return {
        top: `${top}%`,
        width: `${size}px`,
        height: `${size}px`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
        opacity: `${opacity}`,
        '--y-drift': `${yDrift}px`,
      };
    },

    startDustGeneration() {
      // Calculate DUST generated per second
      // Formula: (nightRegistered × 0.5 DUST/day) / 86400 seconds
      const nightAmount = Number(this.balances.nightRegistered) / 1e12;
      const dustPerSecond = (nightAmount * this.dustGenerationRate) / 86400;
      const dustPerSecondBigInt = BigInt(Math.floor(dustPerSecond * 1e12));

      // Update every second
      this.generationInterval = setInterval(() => {
        // Check if we've hit the cap
        if (this.dustGeneratingLive >= this.maxDust) {
          clearInterval(this.generationInterval);
          return;
        }

        // Increment the live value
        this.dustGeneratingLive += dustPerSecondBigInt;

        // Cap at maximum
        if (this.dustGeneratingLive > this.maxDust) {
          this.dustGeneratingLive = this.maxDust;
        }
      }, 1000); // Update every second
    },
  },
});
</script>

<style scoped>
.midnight-balance-card {
  transition: box-shadow 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.midnight-balance-card:hover {
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}

.balance-amount {
  font-size: 1.75rem;
  font-weight: 600;
  margin-top: 8px;
  margin-bottom: 4px;
}

.balance-currency {
  font-size: 1rem;
  font-weight: 400;
  opacity: 0.7;
  margin-left: 4px;
}

.balance-fiat {
  font-size: 0.875rem;
}

.balance-status {
  font-size: 0.875rem;
  margin-top: 4px;
}

.dust-amount {
  color: #CDCD8A;
}

.generating-amount {
  color: #8EC5C1;
  font-weight: 600;
}

.dust-info {
  font-size: 0.75rem;
  margin-top: 4px;
}

.dust-card-tall {
  min-height: 100%;
}

.dust-generation-stats {
  position: relative;
  background: linear-gradient(135deg, rgba(205, 205, 138, 0.08) 0%, rgba(186, 249, 255, 0.08) 100%);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(186, 249, 255, 0.3);
  overflow: hidden;
}

.dust-generation-stats-compact {
  position: relative;
  border-radius: 8px;
  padding: 8px;
  overflow: hidden;
}

.dust-particles {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.dust-particle {
  position: absolute;
  left: -10px;
  background: radial-gradient(circle, #CDCD8A 0%, #A8DFE8 50%, rgba(186, 249, 255, 0.6) 100%);
  border-radius: 50%;
  animation: dust-float ease-in-out infinite;
  box-shadow: 0 0 3px rgba(186, 249, 255, 0.4), 0 0 6px rgba(205, 205, 138, 0.2);
  filter: blur(0.5px);
}

@keyframes dust-float {
  0% {
    transform: translateX(0) translateY(0) rotate(0deg) scale(0.8);
    opacity: 0;
  }
  5% {
    opacity: var(--particle-opacity, 0.3);
  }
  20% {
    transform: translateX(30px) translateY(calc(var(--y-drift) * 0.3)) rotate(45deg) scale(1);
    opacity: var(--particle-opacity, 0.5);
  }
  40% {
    transform: translateX(60px) translateY(calc(var(--y-drift) * 0.6)) rotate(120deg) scale(0.9);
    opacity: var(--particle-opacity, 0.4);
  }
  60% {
    transform: translateX(90px) translateY(calc(var(--y-drift) * 0.9)) rotate(200deg) scale(1.1);
    opacity: var(--particle-opacity, 0.35);
  }
  80% {
    transform: translateX(115px) translateY(var(--y-drift)) rotate(300deg) scale(0.7);
    opacity: var(--particle-opacity, 0.2);
  }
  95% {
    opacity: 0;
  }
  100% {
    transform: translateX(130px) translateY(var(--y-drift)) rotate(360deg) scale(0.5);
    opacity: 0;
  }
}

/* Subtle shimmer on the generating amount */
.generating-amount {
  animation: shimmer 2s ease-in-out infinite;
}

.generating-amount-compact {
  color: #8EC5C1;
  font-weight: 600;
  font-size: 1.5rem;
}

@keyframes shimmer {
  0%, 100% {
    text-shadow: 0 0 8px rgba(186, 249, 255, 0.3);
  }
  50% {
    text-shadow: 0 0 16px rgba(186, 249, 255, 0.6), 0 0 24px rgba(205, 205, 138, 0.3);
  }
}

/* Gradient for DUST progress bar */
.dust-progress-gradient ::v-deep .v-progress-linear__determinate {
  background: linear-gradient(90deg, #CDCD8A 0%, #BAF9FF 100%) !important;
}
</style>
