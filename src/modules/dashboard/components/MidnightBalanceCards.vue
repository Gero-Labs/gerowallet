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
                <div class="balance-currency">{{ dustCurrency }}</div>
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
                  <div class="text-caption text--secondary mb-2" style="position: relative; z-index: 1;">{{ dustCurrency }}</div>

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
                    <span>{{ dustProgress.toFixed(1) }}% of cap ({{ formatDust(maxDust) }} {{ dustCurrency }})</span>
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
                <div class="balance-currency">{{ nightCurrency }}</div>
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
                <div class="balance-currency">{{ nightCurrency }}</div>
              </v-col>

              <!-- Vertical Divider 2 -->
              <v-divider vertical class="d-none d-md-block"></v-divider>

              <!-- NIGHT Registered -->
              <v-col cols="12" md="4" class="pl-md-3">
                <div class="d-flex align-center mb-2">
                  <v-icon :color="registrationStatusColor" class="mr-2" small>{{ registrationStatusIcon }}</v-icon>
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
                <div class="balance-currency">{{ nightCurrency }}</div>
                <!-- Status row: shows current registration state. Mirrors the
                     active-delegation surface on Cardano staking. -->
                <div class="balance-status d-flex align-center mt-1" style="font-size: 0.75rem;">
                  <v-icon x-small :color="registrationStatusColor" class="mr-1">{{ registrationStatusIcon }}</v-icon>
                  <span class="text--secondary">{{ registrationStatusLabel }}</span>
                </div>
                <!-- Action CTA: only shown when registration is actionable. -->
                <v-btn
                  v-if="canRegister"
                  text
                  small
                  color="primary"
                  class="mt-1 px-0"
                  @click="$emit('open-dust-registration')"
                  style="text-transform: none; letter-spacing: 0; min-height: auto; height: 24px;"
                >
                  Register for DUST →
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
// Faithful port of the prototype (new-midnight-backup) — Options API +
// module-level store reads. Two key alignments with the proven Cardano
// pattern in this codebase:
//   1. Module-level `import { midnightStore }` — the imported observable's
//      property reads inside `computed()` are tracked by Vue 2's dep system
//      (same mechanism as `walletStore.account` access elsewhere).
//   2. NO `midnightStore` inside `data()` — Vue 2 would try to re-observe an
//      already-reactive object and break tracking.
// The prototype's mock-data formatters were 12-decimal; this version uses
// the real Midnight indexer decimals (6 for NIGHT, 15 for DUST).
import { defineComponent } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toString();
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

export default defineComponent({
  name: 'MidnightBalanceCards',

  emits: ['open-dust-registration'],

  data() {
    return {
      // Live DUST counter — incremented every second from `dustGenerating`
      // rate until it hits the cap. Reset whenever the store's value changes.
      dustGeneratingLive: 0n as bigint,
      generationInterval: null as number | null,
      // Pre-generated particle styles (prevents stuttering on updates)
      particleStyles: [] as Record<string, string>[],
    };
  },

  mounted() {
    // Pre-generate particle styles to prevent stuttering on updates.
    this.particleStyles = Array.from({ length: 20 }, (_, i) => this.generateParticleStyle(i));
    // Initialize live DUST generation from store value.
    this.dustGeneratingLive = this.balances.dustGenerating ?? 0n;
    this.startDustGeneration();
  },

  beforeDestroy() {
    if (this.generationInterval !== null) {
      clearInterval(this.generationInterval);
    }
  },

  computed: {
    // Reads from module-level imported observable. Vue 2 tracks the
    // `midnightStore.balances` getter access here as a reactive dep.
    balances(): typeof midnightStore.balances {
      return midnightStore.balances;
    },

    isMainnet(): boolean {
      // The Midnight store doesn't currently carry network identity; default
      // to testnet labelling. Update when store gains network.
      return false;
    },

    nightCurrency(): string {
      return this.isMainnet ? 'NIGHT' : 'tNIGHT';
    },

    dustCurrency(): string {
      return this.isMainnet ? 'DUST' : 'tDUST';
    },

    maxDust(): bigint {
      // Spec: cap at 50% of registered NIGHT, expressed in DUST units.
      // Registered NIGHT is in NIGHT base units (10^6); cap is in DUST
      // units (10^15) — multiply by 10^9 to lift to DUST scale, then halve.
      const reg = this.balances.nightRegistered;
      if (reg === 0n) return 0n;
      const dustScale = DUST_DIVISOR / NIGHT_DIVISOR;
      return (reg * dustScale) / 2n;
    },

    dustProgress(): number {
      const cap = this.maxDust;
      if (cap === 0n) return 0;
      const live = this.dustGeneratingLive;
      if (live <= 0n) return 0;
      const pct = Number((live * 10000n) / cap) / 100;
      return Math.min(100, pct);
    },

    // Registration status from midnightStore.dustState (pushed by gero-sync).
    // Mirrors Cardano's account.pool_id-based "active delegation" surface.
    registrationStatus(): 'Unregistered' | 'Pending' | 'Registered' | 'Invalid' {
      const status = midnightStore.dustState?.registrationStatus;
      return (status as 'Unregistered' | 'Pending' | 'Registered' | 'Invalid') ?? 'Unregistered';
    },

    registrationStatusLabel(): string {
      switch (this.registrationStatus) {
        case 'Registered': return 'Generating DUST';
        case 'Pending': return 'Awaiting relay (~2.5h)';
        case 'Invalid': return 'Update DUST address';
        case 'Unregistered':
        default: return 'Not registered';
      }
    },

    registrationStatusIcon(): string {
      switch (this.registrationStatus) {
        case 'Registered': return 'mdi-check-circle';
        case 'Pending': return 'mdi-clock-outline';
        case 'Invalid': return 'mdi-alert-circle-outline';
        case 'Unregistered':
        default: return 'mdi-circle-outline';
      }
    },

    registrationStatusColor(): string {
      switch (this.registrationStatus) {
        case 'Registered': return 'green';
        case 'Pending': return 'amber';
        case 'Invalid': return 'orange';
        case 'Unregistered':
        default: return 'grey';
      }
    },

    // CTA visibility: only show "Register" when actionable. Pending state hides
    // it because there's nothing the user can do but wait.
    canRegister(): boolean {
      return this.registrationStatus === 'Unregistered' || this.registrationStatus === 'Invalid';
    },
  },

  watch: {
    'balances.dustGenerating': {
      immediate: true,
      handler(v: bigint) {
        this.dustGeneratingLive = v ?? 0n;
        this.startDustGeneration();
      },
    },
  },

  methods: {
    formatNight(value: bigint): string {
      return formatBigDecimal(value ?? 0n, NIGHT_DIVISOR, 2);
    },

    formatDust(value: bigint): string {
      return formatBigDecimal(value ?? 0n, DUST_DIVISOR, 4);
    },

    generateParticleStyle(_index: number): Record<string, string> {
      const top = Math.random() * 100;
      const size = Math.random() * 2 + 0.5;
      const duration = Math.random() * 6 + 4;
      const delay = Math.random() * 3;
      const opacity = Math.random() * 0.4 + 0.1;
      const yDrift = (Math.random() - 0.5) * 60;
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
      if (this.generationInterval !== null) {
        clearInterval(this.generationInterval);
        this.generationInterval = null;
      }
      const ratePerSecond = this.balances.dustGenerating ?? 0n;
      if (ratePerSecond <= 0n) return;
      this.generationInterval = window.setInterval(() => {
        const cap = this.maxDust;
        const next = this.dustGeneratingLive + ratePerSecond;
        this.dustGeneratingLive = cap > 0n && next > cap ? cap : next;
        if (cap > 0n && this.dustGeneratingLive >= cap && this.generationInterval !== null) {
          clearInterval(this.generationInterval);
          this.generationInterval = null;
        }
      }, 1000);
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

.balance-status {
  font-size: 0.875rem;
  margin-top: 4px;
}

.dust-amount {
  color: #CDCD8A;
}

.dust-info {
  font-size: 0.75rem;
  margin-top: 4px;
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

.generating-amount-compact {
  color: #8EC5C1;
  font-weight: 600;
  font-size: 1.5rem;
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% {
    text-shadow: 0 0 8px rgba(186, 249, 255, 0.3);
  }
  50% {
    text-shadow: 0 0 16px rgba(186, 249, 255, 0.6), 0 0 24px rgba(205, 205, 138, 0.3);
  }
}

.dust-progress-gradient ::v-deep .v-progress-linear__determinate {
  background: linear-gradient(90deg, #CDCD8A 0%, #BAF9FF 100%) !important;
}
</style>
