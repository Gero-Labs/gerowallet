<template>
  <v-layout class="dao-theme">
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-text class="px-2">
            <!-- ═══ YOUR STATUS BAR ═══ -->
            <v-card outlined flat class="glass-panel pa-0 mb-4">
              <div class="d-flex align-center flex-wrap pa-3" style="gap: 12px">
                <!-- Membership Status -->
                <div class="d-flex align-center">
                  <v-avatar size="32" :color="isMember ? 'success' : 'grey darken-1'" class="mr-2">
                    <v-icon small color="white">{{ isMember ? 'mdi-check' : 'mdi-account-outline' }}</v-icon>
                  </v-avatar>
                  <div>
                    <div class="text-caption grey--text text--lighten-1" style="line-height: 1.1">{{ $t('governance.status') }}</div>
                    <div class="text-subtitle-2 font-weight-semibold" :class="isMember ? 'success--text' : 'grey--text'">
                      {{ isMember ? $t('governance.member') : $t('governance.notAMember') }}
                    </div>
                  </div>
                </div>

                <v-divider vertical class="mx-1" style="border-color: var(--g-hairline-2); max-height: 32px" />

                <!-- Voting Power -->
                <div class="d-flex align-center">
                  <v-icon color="primary" class="mr-2">mdi-lightning-bolt</v-icon>
                  <div>
                    <div class="d-flex align-center" style="line-height: 1.1">
                      <span class="text-caption grey--text text--lighten-1">{{ $t('governance.votingPower') }}</span>
                      <v-tooltip v-if="votingPowerCalcs.length > 0" bottom max-width="320" content-class="custom-tooltip">
                        <template v-slot:activator="{ on, attrs }">
                          <v-icon v-bind="attrs" v-on="on" x-small class="ml-1 grey--text" style="cursor: help">mdi-information-outline</v-icon>
                        </template>
                        <div>
                          <div class="font-weight-medium mb-1">{{ $t('governance.votingPowerRules') }}</div>
                          <div v-for="vpc in votingPowerCalcs" :key="vpc.id" class="mb-2">
                            <div class="font-weight-medium">{{ vpc.name }}</div>
                            <div style="font-size: 11px; line-height: 1.4; opacity: 0.85">{{ vpc.description }}</div>
                            <div v-if="vpc.assets?.length" class="mt-1">
                              <span v-for="asset in vpc.assets" :key="asset.id" class="mr-2" style="font-size: 11px">
                                {{ asset.type }} ({{ asset.weight }}x)
                              </span>
                            </div>
                            <div v-if="vpc.timeBonusMultiplier > 1" style="font-size: 11px; opacity: 0.7; margin-top: 2px">
                              {{ $t('governance.timeBonus') }}: {{ vpc.timeBonusMultiplier }}x {{ $t('governance.after') }} {{ vpc.timeBonusEpochs }} {{ $t('governance.epochs') }}
                            </div>
                          </div>
                        </div>
                      </v-tooltip>
                    </div>
                    <div class="text-subtitle-2 font-weight-semibold primary--text">
                      {{ userVotingPowerDisplay }}
                    </div>
                  </div>
                </div>

                <v-divider vertical class="mx-1" style="border-color: var(--g-hairline-2); max-height: 32px" />

                <!-- Stats -->
                <div class="d-flex align-center">
                  <v-icon color="primary" class="mr-2" small>mdi-account-group</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text">{{ memberCount }}</span>
                  <span class="text-caption grey--text text--lighten-1 ml-1">{{ $t('governance.members') }}</span>
                </div>

                <div class="d-flex align-center">
                  <v-icon color="warning" class="mr-1" small>mdi-shield-crown</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text">{{ adminCount }}</span>
                  <span class="text-caption grey--text text--lighten-1 ml-1">{{ $t('governance.admin') }}</span>
                </div>

                <v-spacer />

                <!-- Actions -->
                <v-btn
                  v-if="!isMember && loggedWallet"
                  small
                  class="geroButton"
                  style="color: var(--g-on-grad) !important"
                  :loading="joiningDao"
                  @click="showJoinFlow()"
                >
                  <v-icon small class="mr-1">mdi-account-plus</v-icon>
                  {{ $t('governance.joinDao') }}
                </v-btn>
                <v-chip v-else-if="isMember" small color="success" outlined>
                  <v-icon small left>mdi-check-circle</v-icon>
                  {{ $t('governance.member') }}
                </v-chip>
              </div>
            </v-card>


            <!-- ═══ Member Growth + Voting Power ═══ -->
            <v-card outlined flat class="glass-panel pa-4 mb-4">
                  <div class="d-flex align-center mb-2">
                    <v-icon color="primary" class="mr-2" small>mdi-chart-line</v-icon>
                    <span class="text-subtitle-2 font-weight-semibold white--text">{{ $t('governance.memberGrowth') }}</span>
                  </div>
                  <div style="height: 180px">
                    <VueHighcharts :options="chartOptions" :redraw="true" :oneToOne="true" />
                  </div>

            </v-card>

            <!-- ═══ GOVERNANCE DETAILS \u2014 Collapsible Cards ═══ -->
            <div class="mb-4">
              <!-- About & How It Works -->
              <v-card flat class="dao-collapsible glass-panel mb-2" @click="toggleSection('about')">
                <div class="d-flex align-center py-3 px-4 dao-collapsible-header">
                  <v-icon color="primary" class="mr-2" small>mdi-information-outline</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text flex-grow-1">
                    {{ $t('governance.aboutDao') }}
                  </span>
                  <v-icon small class="white--text" style="transition: transform 0.2s ease" :style="{ transform: expandedSections.about ? 'rotate(180deg)' : '' }">mdi-chevron-down</v-icon>
                </div>
              </v-card>
              <v-expand-transition>
                <div v-show="expandedSections.about">
                  <div class="dao-collapsible-body glass-panel px-4 pb-4 pt-2">
                    <div class="text-body-2 grey--text text--lighten-1 mb-4 dao-html-content" style="line-height: 1.6; white-space: normal; word-break: break-word" v-html="daoDescription" />
                    <v-row no-gutters>
                      <v-col v-for="pillar in pillars" :key="pillar.icon" cols="12" sm="6" class="pa-2">
                        <div class="d-flex align-start">
                          <v-icon color="primary" small class="mr-2 mt-1 flex-shrink-0">{{ pillar.icon }}</v-icon>
                          <div>
                            <div class="text-caption font-weight-medium white--text">{{ pillar.title }}</div>
                            <div class="text-caption grey--text text--lighten-1" style="line-height: 1.5; white-space: normal; word-break: break-word">
                              {{ pillar.description }}
                            </div>
                          </div>
                        </div>
                      </v-col>
                    </v-row>
                  </div>
                </div>
              </v-expand-transition>

              <!-- Governance Mechanics -->
              <v-card flat class="dao-collapsible glass-panel mb-2" @click="toggleSection('mechanics')">
                <div class="d-flex align-center py-3 px-4 dao-collapsible-header">
                  <v-icon color="primary" class="mr-2" small>mdi-cog-outline</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text flex-grow-1">
                    {{ $t('governance.governanceMechanicsTimelines') }}
                  </span>
                  <v-icon small class="white--text" style="transition: transform 0.2s ease" :style="{ transform: expandedSections.mechanics ? 'rotate(180deg)' : '' }">mdi-chevron-down</v-icon>
                </div>
              </v-card>
              <v-expand-transition>
                <div v-show="expandedSections.mechanics">
                  <div class="dao-collapsible-body glass-panel px-4 pb-4 pt-2">
                    <div class="text-caption grey--text text--lighten-1 mb-3" style="line-height: 1.5; white-space: normal; word-break: break-word">
                      {{ $t('governance.mechanicsDescription') }}
                    </div>
                    <v-simple-table dense class="transparent dao-table">
                      <template v-slot:default>
                        <thead>
                          <tr>
                            <th class="text-left text-caption font-weight-medium">{{ $t('governance.phase') }}</th>
                            <th class="text-left text-caption font-weight-medium">{{ $t('governance.duration') }}</th>
                            <th class="text-left text-caption font-weight-medium">{{ $t('governance.description') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="phase in governancePhases" :key="phase.name">
                            <td class="text-left text-caption font-weight-medium white--text" style="white-space: nowrap">{{ phase.name }}</td>
                            <td class="text-left text-caption primary--text" style="white-space: nowrap">{{ phase.duration }}</td>
                            <td class="text-left text-caption grey--text text--lighten-1" style="white-space: normal; word-break: break-word">{{ phase.description }}</td>
                          </tr>
                        </tbody>
                      </template>
                    </v-simple-table>
                  </div>
                </div>
              </v-expand-transition>

              <!-- Action Permissions -->
              <v-card flat class="dao-collapsible glass-panel mb-2" @click="toggleSection('permissions')">
                <div class="d-flex align-center py-3 px-4 dao-collapsible-header">
                  <v-icon color="primary" class="mr-2" small>mdi-shield-key</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text flex-grow-1">
                    {{ $t('governance.actionPermissions') }}
                  </span>
                  <v-icon small class="white--text" style="transition: transform 0.2s ease" :style="{ transform: expandedSections.permissions ? 'rotate(180deg)' : '' }">mdi-chevron-down</v-icon>
                </div>
              </v-card>
              <v-expand-transition>
                <div v-show="expandedSections.permissions">
                  <div class="dao-collapsible-body glass-panel px-4 pb-4 pt-2">
                    <v-simple-table dense class="transparent dao-table">
                      <template v-slot:default>
                        <thead>
                          <tr>
                            <th class="text-left text-caption font-weight-medium">{{ $t('governance.permission') }}</th>
                            <th class="text-center text-caption font-weight-medium">{{ $t('governance.everyone') }}</th>
                            <th class="text-center text-caption font-weight-medium">{{ $t('governance.allMembers') }}</th>
                            <th class="text-center text-caption font-weight-medium">{{ $t('governance.admin') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="perm in permissions" :key="perm.name">
                            <td class="text-left text-caption" style="white-space: normal; word-break: break-word">
                              {{ perm.name }}
                              <v-tooltip bottom>
                                <template v-slot:activator="{ on, attrs }">
                                  <v-icon v-bind="attrs" v-on="on" x-small class="ml-1 grey--text">mdi-information-outline</v-icon>
                                </template>
                                <span style="max-width: 280px; display: block; white-space: normal">{{ perm.description }}</span>
                              </v-tooltip>
                            </td>
                            <td class="text-center"><v-icon v-if="perm.everyone" small color="success">mdi-check-circle</v-icon></td>
                            <td class="text-center"><v-icon v-if="perm.allMembers" small color="success">mdi-check-circle</v-icon></td>
                            <td class="text-center"><v-icon v-if="perm.admin" small color="success">mdi-check-circle</v-icon></td>
                          </tr>
                        </tbody>
                      </template>
                    </v-simple-table>
                  </div>
                </div>
              </v-expand-transition>

              <!-- Getting Involved & Tokenomics -->
              <v-card flat class="dao-collapsible glass-panel mb-2" @click="toggleSection('involved')">
                <div class="d-flex align-center py-3 px-4 dao-collapsible-header">
                  <v-icon color="primary" class="mr-2" small>mdi-rocket-launch</v-icon>
                  <span class="text-subtitle-2 font-weight-semibold white--text flex-grow-1">
                    {{ $t('governance.gettingInvolved') }}
                  </span>
                  <v-icon small class="white--text" style="transition: transform 0.2s ease" :style="{ transform: expandedSections.involved ? 'rotate(180deg)' : '' }">mdi-chevron-down</v-icon>
                </div>
              </v-card>
              <v-expand-transition>
                <div v-show="expandedSections.involved">
                  <div class="dao-collapsible-body glass-panel px-4 pb-4 pt-2">
                    <div v-for="(step, i) in gettingStarted" :key="i" class="d-flex align-start mb-2">
                      <v-avatar size="20" color="primary" class="mr-2 mt-1 flex-shrink-0">
                        <span class="white--text" style="font-size: 11px; font-weight: 700">{{ i + 1 }}</span>
                      </v-avatar>
                      <div>
                        <div class="text-caption font-weight-medium white--text">{{ step.title }}</div>
                        <div class="text-caption grey--text text--lighten-1" style="font-size: 11px !important; line-height: 1.4; white-space: normal; word-break: break-word">
                          {{ step.subtitle }}
                        </div>
                      </div>
                    </div>

                    <v-divider class="my-3" style="border-color: var(--g-hairline-1)" />

                    <div class="text-caption font-weight-medium white--text mb-2">{{ $t('governance.whoCanParticipate') }}</div>
                    <div class="text-caption grey--text text--lighten-1 mb-2" style="line-height: 1.5; white-space: normal; word-break: break-word">
                      {{ $t('governance.participationDescription') }}
                    </div>
                    <div v-for="req in requirements" :key="req.text" class="d-flex align-center mb-1">
                      <v-icon x-small :color="req.met === false ? 'error' : 'success'" class="mr-2">
                        {{ req.met === false ? 'mdi-close-circle' : 'mdi-check-circle' }}
                      </v-icon>
                      <span class="text-caption white--text" style="white-space: normal; word-break: break-word">{{ req.text }}</span>
                    </div>

                    <v-divider class="my-3" style="border-color: var(--g-hairline-1)" />

                    <div class="text-caption font-weight-medium white--text mb-2">{{ $t('governance.tokenomics') }}</div>
                    <div class="d-flex flex-wrap" style="gap: 6px">
                      <v-chip small outlined color="primary">{{ $t('governance.totalSupply') }}</v-chip>
                      <v-chip small outlined>{{ $t('governance.circulatingSupply') }}</v-chip>
                      <v-chip small outlined>{{ $t('governance.teamAllocation') }}</v-chip>
                    </div>
                  </div>
                </div>
              </v-expand-transition>
            </div>

            <!-- Footer -->
            <div class="text-center text-caption grey--text text--lighten-1 pb-2" style="line-height: 1.6; white-space: normal; word-break: break-word">
              {{ $t('governance.communityGovernanceDescription') }}
            </div>
            <div class="d-flex align-center justify-center pb-2" style="opacity: 0.5">
              <span class="text-caption grey--text">{{ $t('common.poweredBy') }}</span>
              <v-img
                class="ml-1"
                :src="assets.clarityLogo"
                :alt="$t('governance.clarityLogo')"
                width="48"
                max-width="48"
                contain
              />
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- ═══ JOIN DAO DIALOG ═══ -->
    <v-dialog v-model="joinDialog" max-width="440" content-class="liquid-glass-dialog">
      <v-card flat class="pa-0" style="background: transparent !important">
        <v-card-title class="white--text pb-1">
          <v-icon color="primary" class="mr-2">mdi-account-plus</v-icon>
          {{ $t('governance.joinDao') }}
        </v-card-title>
        <v-card-text class="pb-2">
          <div class="text-body-2 grey--text text--lighten-1 mb-3" style="line-height: 1.6; white-space: normal; word-break: break-word">
            {{ $t('governance.joinDaoDescription') }}
          </div>

          <!-- Workflow info if loaded -->
          <div v-if="workflowInfo" class="mb-3">
            <div class="text-caption font-weight-medium white--text mb-2">{{ $t('governance.membershipProcess') }}</div>
            <v-card flat class="liquid-glass-subtle pa-3">
              <div v-for="item in workflowInfo" :key="item.label" class="d-flex align-center mb-1">
                <v-icon x-small :color="item.color" class="mr-2">{{ item.icon }}</v-icon>
                <span class="text-caption grey--text text--lighten-1" style="font-size: 11px !important">
                  {{ item.label }}
                </span>
              </div>
              <div
                v-if="workflowWelcomeMessage"
                class="text-caption grey--text text--lighten-1 mt-2 pt-2"
                style="border-top: 1px solid var(--g-hairline-1); font-size: 11px !important; line-height: 1.5; white-space: normal; word-break: break-word"
                v-html="workflowWelcomeMessage"
              />
            </v-card>
          </div>

          <!-- Requirements check -->
          <v-card flat class="liquid-glass-subtle pa-3 mb-3">
            <div class="text-caption font-weight-medium white--text mb-1">{{ $t('governance.requirements') }}</div>
            <div v-for="req in requirements" :key="'j-' + req.text" class="d-flex align-center mb-1">
              <v-icon x-small :color="req.met === false ? 'error' : 'success'" class="mr-2">
                {{ req.met === false ? 'mdi-close-circle' : 'mdi-check-circle' }}
              </v-icon>
              <span class="text-caption grey--text text--lighten-1" style="white-space: normal; word-break: break-word; font-size: 11px !important">{{ req.text }}</span>
            </div>
          </v-card>

          <!-- Stake address -->
          <div class="text-caption grey--text text--lighten-1 mb-1">{{ $t('governance.yourStakeAddress') }}</div>
          <v-card flat class="liquid-glass-subtle pa-2 d-flex align-center">
            <span class="text-caption white--text flex-grow-1" style="font-family: var(--g-font-mono); font-size: 11px !important; word-break: break-all">
              {{ loggedWallet?.stakeAddress || '\u2014' }}
            </span>
            <CopyButton v-if="loggedWallet?.stakeAddress" x-small :value="loggedWallet.stakeAddress" />
          </v-card>
        </v-card-text>
        <v-card-actions class="px-6 pb-4">
          <v-btn text small @click="joinDialog = false" class="grey--text">{{ $t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn
            small
            class="geroButton"
            style="color: var(--g-on-grad) !important"
            :loading="joiningDao"
            :disabled="!loggedWallet?.stakeAddress || !meetsRequirements"
            @click="confirmJoinDao()"
          >
            <v-icon small class="mr-1">mdi-check</v-icon>
            {{ $t('governance.confirmJoin') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </v-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRefs } from 'vue';
import assets from '@/utils/assets';
import VueHighcharts from '@/shared/components/VueHighcharts.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import clarityApi, { type VotingPowerCalculation, type DaoDetails, type MembershipWorkflow } from '@/api/clarity-api';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

/** Sanitize HTML \u2014 whitelist safe tags only, strip everything else */
const sanitizeHtml = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  const allowedTags = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'a', 'ul', 'ol', 'li', 'span', 'div']);
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!allowedTags.has(el.tagName.toLowerCase())) {
          // Replace disallowed element with its text content
          const text = document.createTextNode(el.textContent || '');
          node.replaceChild(text, child);
        } else {
          // Strip event handlers and dangerous attributes
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('on') || attr.name === 'style' || (attr.name === 'href' && (attr.value.toLowerCase().startsWith('javascript') || attr.value.toLowerCase().startsWith('data:')))) {
              el.removeAttribute(attr.name);
            }
          }
          if (el.tagName === 'A') el.setAttribute('rel', 'noopener noreferrer');
          walk(child);
        }
      }
    }
  };
  walk(div);
  return div.innerHTML;
};

// ── State ──
const daoName = ref('Gero DAO');
const daoDescription = ref(String(t('governance.geroDAODescription')));
const daoDetailsData = ref<DaoDetails | null>(null);
const members = ref<Record<string, number>>({});
const votingPowerCalcs = ref<VotingPowerCalculation[]>([]);
const userVotingPower = ref<number | null>(null);
const membershipWorkflow = ref<MembershipWorkflow | null>(null);
const isMember = ref(false);
const joiningDao = ref(false);
const joinDialog = ref(false);
const expandedSections = reactive({ about: false, mechanics: false, permissions: false, involved: false });

// ── Computed ──
const memberCount = computed(() => Object.keys(members.value).length);
const adminList = computed(() => daoDetailsData.value?.admins || []);
const adminCount = computed(() => adminList.value.length || 1);

// Parse workflow config into displayable items
const workflowInfo = computed(() => {
  const wf = membershipWorkflow.value;
  if (!wf || typeof wf !== 'object') return null;
  const items: { label: string; icon: string; color: string }[] = [];

  if ('autoApprove' in wf) {
    items.push({
      label: wf.autoApprove
        ? String(t('governance.autoApproved'))
        : String(t('governance.requiresApproval')),
      icon: wf.autoApprove ? 'mdi-check-circle' : 'mdi-clock-outline',
      color: wf.autoApprove ? 'success' : 'warning',
    });
  }
  if ('minimumStake' in wf && wf.minimumStake) {
    items.push({
      label: `${String(t('governance.minimumStake'))}: ${Number(wf.minimumStake).toLocaleString()} $GERO`,
      icon: 'mdi-currency-usd',
      color: 'primary',
    });
  }
  return items.length > 0 ? items : null;
});

const workflowWelcomeMessage = computed(() => {
  const wf = membershipWorkflow.value;
  if (!wf || typeof wf !== 'object') return '';
  const raw = wf.welcomeMessage || wf.description || '';
  return typeof raw === 'string' ? sanitizeHtml(raw) : '';
});

const userVotingPowerDisplay = computed(() => {
  if (userVotingPower.value === null) return '\u2014';
  return userVotingPower.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
});

// ── Static data ──
const pillars = computed(() => [
  { icon: 'mdi-treasure-chest', title: String(t('governance.treasuryOfTokens')), description: String(t('governance.treasuryDescription')) },
  { icon: 'mdi-book-open-variant', title: String(t('governance.magicRuleBook')), description: String(t('governance.magicRuleBookDescription')) },
  { icon: 'mdi-vote', title: String(t('governance.votingWithYourAda')), description: String(t('governance.votingWithAdaDescription')) },
  { icon: 'mdi-handshake', title: String(t('governance.actionByAgreement')), description: String(t('governance.actionByAgreementDescription')) },
]);

const governancePhases = computed(() => [
  { name: String(t('governance.draftPeriod')), duration: String(t('governance.twentyFourHours')), description: String(t('governance.draftPeriodDescription')) },
  { name: String(t('governance.votingWindow')), duration: String(t('governance.fourteenDays')), description: String(t('governance.votingWindowDescription')) },
  { name: String(t('governance.followUpVoting')), duration: String(t('governance.upTo10Days')), description: String(t('governance.followUpVotingDescription')) },
  { name: String(t('governance.tokenLockup')), duration: String(t('governance.twentyFourHours')), description: String(t('governance.tokenLockupDescription')) },
  { name: String(t('governance.executionWindow')), duration: String(t('governance.upTo180Days')), description: String(t('governance.executionWindowDescription')) },
  { name: String(t('governance.cooldownBetweenVotes')), duration: String(t('governance.oneHourMinimum')), description: String(t('governance.cooldownDescription')) },
]);

const gettingStarted = computed(() => [
  { title: String(t('governance.acquireHoldGero')), subtitle: String(t('governance.makesSureWalletMeetsThresholds')) },
  { title: String(t('governance.connectYourWallet')), subtitle: String(t('governance.useCardanoCompatibleWallet')) },
  { title: String(t('governance.joinOnClarity')), subtitle: String(t('governance.visitGeroDAOPage')) },
]);

const permissions = computed(() => [
  { name: String(t('governance.voteOnSnapshot')), description: String(t('governance.voteOnSnapshotDesc')), everyone: true, allMembers: true, admin: true },
  { name: String(t('governance.createSnapshot')), description: String(t('governance.createSnapshotDesc')), everyone: false, allMembers: false, admin: true },
  { name: String(t('governance.approveSnapshot')), description: String(t('governance.approveSnapshotDesc')), everyone: false, allMembers: false, admin: true },
  { name: String(t('governance.manageSnapshot')), description: String(t('governance.manageSnapshotDesc')), everyone: false, allMembers: false, admin: true },
  { name: String(t('governance.approveIncentive')), description: String(t('governance.approveIncentiveDesc')), everyone: false, allMembers: false, admin: true },
  { name: String(t('governance.manageIncentive')), description: String(t('governance.manageIncentiveDesc')), everyone: false, allMembers: false, admin: true },
]);

const workflowMinimumStake = computed(() => {
  const wf = membershipWorkflow.value;
  if (!wf || typeof wf !== 'object') return 0;
  return Number(wf.minimumStake) || 0;
});

const meetsRequirements = computed(() => {
  if (workflowMinimumStake.value <= 0) return true;
  return (userVotingPower.value ?? 0) >= workflowMinimumStake.value;
});

const requirements = computed(() => {
  const reqs: { text: string; met: boolean | null }[] = [];
  const wf = membershipWorkflow.value;

  if (wf && typeof wf === 'object' && wf.minimumStake) {
    const min = Number(wf.minimumStake);
    const userPower = userVotingPower.value ?? 0;
    reqs.push({
      text: `${String(t('governance.minimumVotingPower'))}: ${min.toLocaleString()} (${String(t('governance.yours'))}: ${userPower.toLocaleString()})`,
      met: userPower >= min,
    });
  }

  reqs.push({ text: String(t('governance.mustHaveStakeAddress')), met: !!loggedWallet.value?.stakeAddress });

  return reqs;
});

// ── Chart ──
const memberGrowthData = computed(() => {
  const timestamps = Object.values(members.value).filter(t => t > 0).sort((a, b) => a - b);
  if (timestamps.length === 0) return { categories: [] as string[], data: [] as number[] };

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buckets = new Map<string, number>();

  // Count members per month
  for (const ts of timestamps) {
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  // Build continuous range from first to last month
  const first = new Date(timestamps[0]);
  const last = new Date(timestamps[timestamps.length - 1]);
  const categories: string[] = [];
  const data: number[] = [];
  let cumulative = 0;
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);

  while (cursor <= last || categories.length < 2) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth()).padStart(2, '0')}`;
    const label = `${monthNames[cursor.getMonth()]} '${String(cursor.getFullYear()).slice(2)}`;
    cumulative += buckets.get(key) || 0;
    categories.push(label);
    data.push(cumulative);
    cursor.setMonth(cursor.getMonth() + 1);
    if (categories.length > 36) break; // safety cap
  }

  return { categories, data };
});

const chartOptions = computed(() => {
  const { categories, data } = memberGrowthData.value;
  const max = data.length > 0 ? Math.max(...data) : 10;
  return {
    chart: { type: 'area', backgroundColor: 'transparent', height: 180, style: { fontFamily: 'inherit' }, spacing: [10, 0, 10, 0] },
    title: { text: null },
    xAxis: {
      categories,
      gridLineColor: 'transparent',
      lineColor: 'rgba(255,255,255,0.08)',
      tickColor: 'transparent',
      labels: { style: { color: 'rgba(255,255,255,0.35)', fontSize: '9px' }, step: categories.length > 12 ? Math.ceil(categories.length / 12) : 1 },
    },
    yAxis: {
      title: { text: null },
      gridLineColor: 'rgba(255,255,255,0.04)',
      lineColor: 'transparent',
      labels: { style: { color: 'rgba(255,255,255,0.35)', fontSize: '9px' } },
      min: 0, max: Math.ceil(max * 1.1) || 10,
    },
    legend: { enabled: false },
    plotOptions: {
      area: {
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(0, 199, 243, 0.2)'], [1, 'rgba(0, 250, 213, 0.02)']] },
        lineColor: '#00c7f3',
        lineWidth: 2,
        marker: { enabled: false },
        states: { hover: { lineWidth: 2 } },
      },
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderColor: 'rgba(0, 199, 243, 0.3)',
      borderRadius: 8,
      style: { color: 'white', fontSize: '11px' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: function (this: any) { return `<b>${this.x}</b><br/>${String(t('governance.members'))}: <b>${this.y}</b>`; },
    },
    series: [{ name: String(t('governance.members')), data }],
    credits: { enabled: false },
  };
});

// ── Helpers ──
const toggleSection = (section: keyof typeof expandedSections): void => {
  expandedSections[section] = !expandedSections[section];
};

// ── Join DAO ──
const showJoinFlow = async (): Promise<void> => {
  joinDialog.value = true;
  const promises: Promise<void>[] = [];

  // Load membership workflow
  if (!membershipWorkflow.value) {
    promises.push(
      clarityApi.getWorkflow('newMemberApplication').then(res => {
        membershipWorkflow.value = res.data;
      }).catch(() => { /* Workflow not available */ })
    );
  }

  // Refresh voting power to verify requirements
  const stakeAddr = loggedWallet.value?.stakeAddress;
  if (stakeAddr && votingPowerCalcs.value.length > 0) {
    promises.push(
      clarityApi.getUserVotingPower(stakeAddr, votingPowerCalcs.value[0].id).then(res => {
        userVotingPower.value = typeof res.data === 'number' ? res.data : 0;
      }).catch(() => { /* Voting power not available */ })
    );
  }

  await Promise.allSettled(promises);
};

const confirmJoinDao = async (): Promise<void> => {
  if (!loggedWallet.value?.stakeAddress) return;
  joiningDao.value = true;
  try {
    await clarityApi.addMember(loggedWallet.value.stakeAddress);
    isMember.value = true;
    joinDialog.value = false;
    snackbar.fireSuccess(t('governance.joinedDao'));
    // Refresh members
    const res = await clarityApi.getDaoMembers();
    members.value = res.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Failed to join DAO:', error);
    snackbar.setError(error?.response?.data || error?.message || String(t('governance.unknownError')));
  } finally {
    joiningDao.value = false;
  }
};

// ── Lifecycle \u2014 Load all data in parallel ──
onMounted(async () => {
  const stakeAddr = loggedWallet.value?.stakeAddress;

  const promises: Promise<void>[] = [
    // 1. DAO details (getGeroDetails)
    clarityApi.getGeroDetails().then(res => {
      const data = res.data;
      daoDetailsData.value = data;
      if (data?.name) daoName.value = data.name;
      if (data?.description) daoDescription.value = sanitizeHtml(data.description);
    }).catch(err => console.warn('DAO details:', err)),

    // 2. Members (getDaoMembers)
    clarityApi.getDaoMembers().then(res => {
      members.value = res.data;
      if (stakeAddr) isMember.value = stakeAddr in res.data;
    }).catch(err => console.warn('Members:', err)),

    // 3. Voting power calculations (getVotingPowerCalculations)
    clarityApi.getVotingPowerCalculations().then(async res => {
      votingPowerCalcs.value = Array.isArray(res.data) ? res.data : [];
      // User voting power (getUserVotingPower) \u2014 depends on calculations
      if (stakeAddr && res.data?.length > 0) {
        try {
          const vpRes = await clarityApi.getUserVotingPower(stakeAddr, res.data[0].id);
          userVotingPower.value = vpRes.data;
        } catch { /* Not available */ }
      }
    }).catch(err => console.warn('Voting power calcs:', err)),

  ];

  await Promise.allSettled(promises);
});
</script>

<style scoped>
.dao-theme .dao-table th {
  border-bottom: 1px solid var(--g-hairline-1) !important;
  color: var(--g-text-3) !important;
}
.dao-theme .dao-table td {
  border-bottom: 1px solid var(--g-hairline-1) !important;
}
.dao-theme .dao-table tr:hover td {
  background: var(--g-hairline-1) !important;
}

.cursor-pointer {
  cursor: pointer;
}
</style>

<!-- Unscoped for Vuetify child selectors -->
<style>
/* Surfaces come from the shared .glass-panel material; only behavior and the
   header/body join geometry stay local. */
.dao-collapsible {
  cursor: pointer;
}
.dao-collapsible-header:hover {
  background: var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.dao-collapsible-body {
  border-top: none;
  border-radius: 0 0 var(--g-r-card) var(--g-r-card);
  margin-top: -4px;
}

.dao-html-content p { margin-bottom: 8px; }
.dao-html-content p:last-child { margin-bottom: 0; }
.dao-html-content a { color: var(--g-accent); text-decoration: none; }
.dao-html-content a:hover { text-decoration: underline; }

</style>
