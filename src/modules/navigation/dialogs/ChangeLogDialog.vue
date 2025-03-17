<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="What's New?"
    subtitle="Gero Dashboard change log"
    :loading="loading"
    :min-height="0"
    :persistent="persistent"
  >
    <v-card-title class="pa-0">
    </v-card-title>
    <v-card-text class="px-3 justify-center text-center pb-0" style="z-index: 1; min-height: 0; height: 608px">
      <v-timeline align-top dense class="pt-0 mt-4">
        <v-timeline-item small color="#00DFF3">
          <v-card class="transparent" flat style="background-image: linear-gradient(90deg, rgba(153, 153, 153, 0.05) 0%, rgba(163.62, 238.55, 255, 0.05) 100%); border-radius: 24px; ">
            <v-card-text class="text-left">
              <v-expansion-panels v-model="panel"  flat >
                <v-expansion-panel class="transparent" flat >
                  <v-expansion-panel-header class="pa-0">
                    <v-card-title class="py-0">v2.4.2</v-card-title>
                  </v-expansion-panel-header>
                  <v-expansion-panel-content>

                  </v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-card-text>
          </v-card>
        </v-timeline-item>
        <v-timeline-item small color="#00DFF3">
          <v-card class="transparent" flat style="background-image: linear-gradient(90deg, rgba(153, 153, 153, 0.05) 0%, rgba(163.62, 238.55, 255, 0.05) 100%); border-radius: 24px; ">
            <v-card-text class="text-left">
              <v-expansion-panels flat >
                <v-expansion-panel class="transparent" flat >
                  <v-expansion-panel-header class="pa-0">
                    <v-card-title class="py-0">v2.4.1</v-card-title>
                  </v-expansion-panel-header>
                  <v-expansion-panel-content>
                    <h2 class="pb-2"><u>New Features</u></h2>
                    <h3>Welcome Screen</h3>
                    <p>With every major version update, we now introduce a welcome screen that highlights what's new. For the official release of Gero Dashboard 2.4, a welcome flow is available and can be accessed anytime from the wallet settings.</p>

                    <h3>Price % Change Display</h3>
                    <p>We have added a new feature to display the 24-hour percentage change for ADA and Apex prices.</p>

                    <h3>Dev Tools</h3>
                    <p>Developers now have access to a secret developer screen for blockchain-related converters. You can access this screen by appending <code>/dev-tools</code> to the extension URL. The tools available include:</p>
                    <ul>
                      <li>Tx CBOR Hex to JSON Converter</li>
                      <li>WitnessSet CBOR Hex to JSON Converter</li>
                      <li>Address CBOR Hex to Bech32 Converter</li>
                      <li>Address Bech32 to Hex Converter</li>
                      <li>String to Hex Converter</li>
                      <li>UTxO CBOR to JSON Converter</li>
                      <li>Lovelace to Value Converter</li>
                    </ul>
                    <br>
                    <h2 class="pb-2"><u>Bug Fixes</u></h2>
                    <h3>Token Table Price Change</h3>
                    <p>Resolved an issue where the price change in the tokens table was displaying incorrect percentages.</p>

                    <h3>CIP-30 Address Issues</h3>
                    <p>Fixed a problem with unused addresses as per CIP-30 requirements.</p>

                    <h3>CIP-30 UTxO Retrieval</h3>
                    <p>Addressed issues related to <code>getUtxos</code>: Fixed a bug affecting unfrack.it, where UTxOs with amount were not correctly processed. Fixed retrieval of unsignable UTxOs beyond the 20-gap limit.</p>

                    <h2 class="pb-2"><u>Performance Enhancements</u></h2>
                    <h3>Removed WebSockets</h3>
                    <p>WebSockets have been removed to streamline real-time communications.</p>

                    <h3>Backend Caching Improvements</h3>
                    <p>We have made significant improvements to backend caching, ensuring faster data retrieval and a smoother user experience.</p>

                    <h3>Better Error Handling</h3>
                    <p>Enhanced error handling mechanisms to provide clearer feedback and a more robust overall experience.</p>
                  </v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-card-text>
          </v-card>
        </v-timeline-item>
      </v-timeline>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import ContactsTab from '@/modules/dashboard/components/ContactsTab.vue';
import PasswordTab from '@/modules/dashboard/components/PasswordTab.vue';
import CollateralTab from '@/modules/dashboard/components/CollateralTab.vue';
import ProfileTab from '@/modules/dashboard/components/ProfileTab.vue';
import ConnectedDappsTab from '@/modules/dashboard/components/ConnectedDappsTab.vue';
import AdvancedSettingsTab from '@/modules/dashboard/components/AdvancedSettingsTab.vue';

export default {
  name: 'ChangeLogDialog',
  components: { BaseDialog},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    persistent: {
      type: Boolean,
      default: true,
    }
  },
  data: () => ({
    loading: false,
    panel: 0
  }),
};
</script>
<style>
.v-application--is-ltr .v-timeline--dense:not(.v-timeline--reverse)::before {
  left: calc(48px - 1px);
  right: initial;
  border-left: dotted 2px #65656582;
}

.theme--dark.v-timeline .v-timeline-item__dot {
  border-radius: 28px;
  background-color: rgb(16, 61, 65);
  width: 24px;
  height: 24px;
}

.v-timeline-item__dot--small .v-timeline-item__inner-dot {
  border-radius: 28px;
  background-color: #00dff3!important;
  width: 8px;
  height: 8px;
  margin: 8px auto auto;

}
</style>
