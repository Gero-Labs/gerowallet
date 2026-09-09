<template>
  <div v-if="showAny">
    <!-- This wallet's fees: the "Fee wallet" strip, in whichever state applies. -->
    <MidnightFeeWalletStrip
      v-if="showFeeWallet"
      :compact="compact"
      :incoming="incoming"
      :candidate="incomingCandidate"
      :network-mismatch="networkMismatch"
      :removed="sponsorRemoved"
      :sponsor-network="sponsorRecord ? sponsorRecord.network : ''"
      :sponsor-unlock="sponsorUnlock"
      :has-own-dust="hasOwnDust"
      :network="network"
      @choose="$emit('choose')"
      @turn-off="turnOffMine"
      @check-now="refresh"
    />

    <!-- The reciprocal side, on the paying wallet. Without it the sponsor's
         DUST drains with nothing on screen to explain it. -->
    <div v-if="outgoing.length" class="pf">
      <div class="pf-row">
        <v-tooltip top max-width="260" content-class="custom-tooltip">
          <template #activator="{ on, attrs }">
            <span class="pf-t" v-bind="attrs" v-on="on">
              {{ t('midnight.sponsor.paysFeesFor') }}
            </span>
          </template>
          <span>{{ t('midnight.sponsor.tipPaysFees', { name: outgoing[0].walletName }) }}</span>
        </v-tooltip>
      </div>
      <div v-for="link in outgoing" :key="link.walletId" class="pf-row">
        <span class="av">{{ initials(link.walletName) }}</span>
        <span class="pf-name">{{ link.walletName }}</span>
        <span class="pf-auth">{{ t('midnight.sponsor.authYours') }}</span>
        <span class="grow"></span>
        <button type="button" class="pf-stop" @click="stop(link.walletId)">
          {{ t('midnight.sponsor.stop') }}
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Sponsorship state for the active Midnight wallet, in both directions.
 *
 * Both sides are shown deliberately: the sponsored wallet has an empty battery
 * and the paying wallet an unexplained drain, on screens that otherwise never
 * mention each other.
 *
 * Stored links are a PREFERENCE — "pre-selected" means the picker is skipped,
 * nothing more. Whether that wallet can still pay is resolved live here, so a
 * pairing that has drained or fallen behind the relay says so instead of
 * quietly failing at send time.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { geroStore } from '@/stores/geroStore';
import MidnightFeeWalletStrip from '@/modules/dashboard/components/MidnightFeeWalletStrip.vue';
import { loadSponsorCandidates } from '@/chains/midnight/midnightSponsorLookup';
import type { SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';
import {
  clearSponsorLink,
  loadSponsorLinks,
  sponsoredByWallet,
  type SponsorLink,
  type SponsorLinkMap,
} from '@/chains/midnight/midnightSponsorLinks';

const props = withDefaults(defineProps<{
  /**
   * Render the fee-wallet strip even with nothing configured, so the dashboard
   * can offer the "off" state next to the DUST registration prompt.
   */
  showWhenOff?: boolean;
  /** One-line layout, for the side panel. */
  compact?: boolean;
  /**
   * Bump to force a re-read. The fee-wallet dialog writes the link and closes;
   * without this the strip kept rendering its pre-save state — it only reloaded
   * on mount or on a wallet switch — so choosing a fee wallet looked like
   * nothing had happened.
   */
  revision?: number;
}>(), { showWhenOff: true, compact: false, revision: 0 });

defineEmits<{ (e: 'choose'): void }>();

const { t } = useTranslation();

const links = ref<SponsorLinkMap>({});
const candidates = ref<SponsorCandidate[]>([]);

const walletId = computed(() => walletStore.loggedWallet?.id ?? null);
const network = computed(() => walletStore.loggedWallet?.network ?? '');

/**
 * Read the raw entry rather than `linkFor`, which filters by network: the
 * "different network" state needs to SEE a mismatched pairing in order to
 * report it, instead of silently rendering as unconfigured.
 */
const incoming = computed<SponsorLink | null>(() => (
  walletId.value == null ? null : (links.value[String(walletId.value)] ?? null)
));

const sponsorRecord = computed(() => (
  incoming.value ? (geroStore.wallets?.[incoming.value.sponsorWalletId] ?? null) : null
));

/**
 * The stored sponsor no longer exists in this extension. Distinct from "not
 * checked": without this the strip reported a deleted wallet as merely unread,
 * with copy telling the user it would be checked at the next send — which can
 * never happen.
 */
const sponsorRemoved = computed(() => !!incoming.value && !sponsorRecord.value);

const networkMismatch = computed(() => (
  !!sponsorRecord.value && !!network.value && sponsorRecord.value.network !== network.value
));

const sponsorUnlock = computed(() => sponsorRecord.value?.encryptionMethod ?? 'password');

/** Does the ACTIVE wallet hold any DUST of its own? */
const hasOwnDust = computed(() => {
  const ds = midnightStore.dustState;
  return !!ds && typeof ds.current === 'bigint' && ds.current > 0n;
});

const incomingCandidate = computed<SponsorCandidate | null>(() => (
  incoming.value
    ? (candidates.value.find((c) => c.walletId === incoming.value?.sponsorWalletId) ?? null)
    : null
));

/** Wallets this one pays for, with the sponsored wallet's current name. */
const outgoing = computed(() => {
  if (walletId.value == null) return [];
  return sponsoredByWallet(links.value, walletId.value, network.value).map((l) => ({
    ...l,
    walletName: geroStore.wallets?.[l.walletId]?.name ?? `#${l.walletId}`,
  }));
});

const showFeeWallet = computed(() => !!incoming.value || props.showWhenOff);
const showAny = computed(() => showFeeWallet.value || outgoing.value.length > 0);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function refresh(): Promise<void> {
  links.value = await loadSponsorLinks();
  if (walletId.value == null || !network.value) return;
  // Resolving live state is what turns a stored preference into an honest
  // reading; without it a drained sponsor would still render as ready.
  candidates.value = (await loadSponsorCandidates(walletId.value, network.value)).candidates;
}

/** Turn off the pairing where THIS wallet is the one being paid for. */
async function turnOffMine(): Promise<void> {
  if (walletId.value == null) return;
  await clearSponsorLink(walletId.value);
  await refresh();
}

async function stop(sponsoredWalletId: number): Promise<void> {
  await clearSponsorLink(sponsoredWalletId);
  await refresh();
}

onMounted(refresh);
// Scalar key — a new array each tick would re-read storage continuously.
watch(() => `${walletId.value}|${network.value}|${props.revision}`, refresh);
</script>

<style lang="scss" scoped>
.pf {
  margin-top: var(--g-s-3);
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}

.pf-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);

  & + & {
    margin-top: var(--g-s-2);
  }
}

.grow {
  flex: 1 1 auto;
}

.pf-t {
  color: var(--g-text-1);
  font-weight: 600;
}

.pf-name {
  color: var(--g-text-1);
}

.pf-auth,
.pf-sub {
  color: var(--g-text-3);
}

.av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  flex: none;
}

.pf-stop {
  color: var(--g-text-2);
  text-decoration: underline;
  transition: color var(--g-dur-fast) ease;

  &:hover {
    color: var(--g-text-1);
  }
}

.pf-sub {
  margin-top: var(--g-s-2);
}
</style>
