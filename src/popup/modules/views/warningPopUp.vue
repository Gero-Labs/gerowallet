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
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
            if (response && response.hasOverlay) {
              chrome.tabs.sendMessage(tab.id, { action: 'overlayClosed' });
            }
          });
        });

        chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
          if (activeTabs.length > 0) {
            chrome.tabs.remove(activeTabs[0].id);
          }
        });
      });
    },

    async safety() {
      chrome.tabs.query({}, async tabs => {
        const overlayRemovalPromises = tabs.map(tab => {
          return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
              if (response && response.hasOverlay) {
                if (tabs.length === 2) {
                  chrome.tabs.update(tab.id, { url: 'https://www.google.com' }, () => {
                    resolve();
                  });
                } else {
                  chrome.tabs.remove(tab.id, () => {
                    resolve();
                  });
                }
              } else {
                resolve();
              }
            });
          });
        });
        await Promise.all(overlayRemovalPromises);
        chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
          if (activeTabs.length > 0) {
            chrome.tabs.remove(activeTabs[0].id);
          }
        });
      });
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
                  resolve(); 
                }
              });
            });
          });
          await Promise.all(navigateToreportPromise);
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
.outer-container {
  position: absolute;
  border: 5px solid #ff8e8e;
  text-align: center;
  width: 100%;
  height: 100%;
  color: white;
  padding: 5px 0px;
  cursor: move;
}
.warning-popup-logo {
  display: block;
}
.title {
  color: #ff8e8e;
  text-align: center;
  font-size: 1.5rem;
  display: block;
}
.subtext {
  color: #ffffff;
  font-size: 14px;
}
.sub-title {
  color: #00221c;
  background-color: #ff8e8e;
  font-size: 19px;
  font-weight: 500;
}
.continue-btn {
  background: linear-gradient(45deg, #00c8f4, #00f6d7); /* Gradient colors */
  border: none; /* Remove border */
}

.backsfty-btn {
  position: relative;
  display: inline-block;
  padding: 0.5rem 1.5rem;
  color: #f5f5f5;
  background-color: #1f1d1d;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  z-index: 1;
  overflow: hidden;
}

.backsfty-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 0.5rem;
  padding: 1.5px; /* Adjust based on your desired border width */
  background: linear-gradient(to right, rgb(255, 13, 0), rgb(255, 102, 102));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;
  mask-composite: exclude;
  z-index: -1;
  transition: background 0.3s ease;
}

.backsfty-btn:hover::before {
  background: linear-gradient(to right, rgb(255, 102, 102), rgb(255, 13, 0));
}
.custom-checkbox {
  display: flex;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.custom-checkbox input[type='checkbox'] {
  display: none;
}

.custom-checkbox label {
  position: relative;
  padding-left: 30px; /* Space for custom checkbox */
  cursor: pointer;
  display: flex;
  align-items: flex-start;
}
.custom-checkbox label::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 20px;
  height: 20px;
  border: 2px solid black; /* Border color */
  background: white; /* Default background */
  border-radius: 3px; /* Rounded corners */
  transition: background 0.3s; /* Smooth transition */
}
.custom-checkbox input[type='checkbox']:checked + label::before {
  background: #00dff3;
  border-color: #00f6d7;
}
.custom-checkbox input[type='checkbox']:checked + label::after {
  content: '✔';
  position: absolute;
  left: 5px;
  top: 0;
  color: black;
  font-size: 16px;
}

.custom-checkbox p {
  margin: 0;
  line-height: 1.2;
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
