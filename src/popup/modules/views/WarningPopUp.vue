<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Warning - Continue with Caution!" ref="popupHeader" :show-website="!($route.query['website'] === 'undefined' || Object.keys(this.$route.query).length === 0)" :show-wallet="false">
      <v-card-subtitle class="sub-title text-center my-2 py-2" style="color: #00221c; font-size: 19px">This website is blacklisted by Cardano Shield</v-card-subtitle>
      <v-card-text class="d-flex flex-column justify-center py-0 px-3" id="main-content" style="flex: 1 1 auto; overflow-y: auto; max-height: 100%; height:0;">
        By checking the boxes below, you understand and acknowledge the following:
        <div class="checkboxes">
          <v-checkbox
            v-model="checkbox1"
            label="This Website is blacklisted or suspected of being malicious and may be impersonating another legitimate website."
            hide-details
            required
            :rules="[v => !!v || 'You must agree to continue!']"
          />
          <v-checkbox
            v-model="checkbox2"
            label="This Website may attempt to steal my funds by presenting false or misleading information"
            hide-details
            required
            :rules="[v => !!v || 'You must agree to continue!']"
          />
        </div>
      </v-card-text>
      <v-card-actions class="d-flex flex-column">
        <div class="my-2">
          <v-btn id="report-btn" @click="reportSite">Report this site as safe!</v-btn>
        </div>
        <div class="my-2 d-flex" style="justify-content: space-between; width: 100%">
          <v-btn outlined @click="safety">
            <v-icon small class="mr-1">
              mdi-arrow-left
            </v-icon>
            Back to Safety
          </v-btn>
          <v-btn class="geroButton" @click="proceed" :disabled="!valid" style="text-transform: uppercase; color: black!important;">
            Continue to site
            <v-icon small class="mr-1" style="color: black!important;">
              mdi-arrow-right
            </v-icon>
          </v-btn>
        </div>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script>
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';

export default {
  name: 'WarningPopUp',
  components: { PopupHeader },
  data() {
    return {
      valid: false,
      checkbox1: false,
      checkbox2: false,
      suspiciousUrl: null,
    };
  },
  async created() {
    const queryParams = this.$route.query;
    if (Object.keys(queryParams).length > 0) {
      this.suspicious_url = queryParams['website'];
    } else {
      console.warn('No website query parameter found');
    }
  },
  methods: {
    proceed() {
      if (chrome?.tabs) {
        chrome.tabs.query({}, tabs => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
              if (response && response.hasOverlay) {
                chrome.tabs.sendMessage(tab.id, { action: 'overlayClosed' });
              }
            });
          });
          // Close the popup tab
          chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
            if (activeTabs.length > 0) {
              chrome.tabs.remove(activeTabs[0].id);
            }
          });
        });
      }
    },
    async safety() {
      if (chrome?.tabs) {
        // Loop over all tabs and find which has overlay
        // Close both the tabs: the popup one and the suspicious one
        chrome.tabs.query({}, async tabs => {
          // Create an array of promises to check for overlays and remove the tabs
          const overlayRemovalPromises = tabs.map(tab => {
            return new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
                if (response && response.hasOverlay) {
                  // If the tab has the overlay, close this tab
                  chrome.tabs.remove(tab.id, () => {
                    resolve(); // Resolve the promise once the tab is closed
                  });
                } else {
                  resolve(); // Resolve immediately if no overlay
                }
              });
            });
          });

          // Wait for all overlay tabs to be closed
          await Promise.all(overlayRemovalPromises);

          // Close the popup tab
          chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
            if (activeTabs.length > 0) {
              chrome.tabs.remove(activeTabs[0].id);
            }
          });
        });
      }
    },
    async reportSite() {
      if (chrome?.tabs) {
        chrome.tabs.query({}, async tabs => {
          const navigateToreportPromise = tabs.map(tab => {
            return new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
                if (response && response.hasOverlay) {
                  chrome.tabs.sendMessage(tab.id, { action: 'reportSite' }, response => {
                    if (response && response.action === 'navigateToReport') {
                      chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`index.html#/transactions?website=${this.suspicious_url}`) });
                      resolve();
                    }
                  });
                } else {
                  resolve(); // Resolve immediately if no overlay
                }
              });
            });
          });
          await Promise.all(navigateToreportPromise);
          // Close the popup tab
          chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
            if (activeTabs.length > 0) {
              chrome.tabs.remove(activeTabs[0].id);
            }
          });
        });
      }
    },
  },
};
</script>
<style scoped>
.sub-title {
  color: #00221c;
  background-color: #ff8e8e;
  font-size: 19px;
  font-weight: 500;
}

.checkboxes {
  display: flex;
  align-items: flex-start;
  flex-flow: column;
}

#report-btn {
  background-color: #002a23;
  color: white;
  border: 2px solid #00f6d7;
}
#main-content {
  color: #ffffff;
  font-size: 1rem;
  font-weight: 400;
  text-align: left;
}
</style>
