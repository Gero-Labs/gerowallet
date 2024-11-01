<template>
  <v-card flat class="outer-container" id="warningPopup">
    <div class="warning-popup-logo">
      <div style="width: 100px; margin: auto" class="py-3">
        <img alt="Gero Logo" id="modal-logo-icon" width="100" :src="require('@/assets/svg/gero-logo.svg')" />
        <img alt="Gero Logo" id="modal-logo-text" width="100" :src="require('@/assets/svg/gero-text.svg')" />
      </div>
    </div>
    <v-card-title class="title">
      <div>Warning - Continue With Caution</div>
      <div class="subtext">Website: {{ suspicious_url }}</div>
      <div class="sub-title">This website is blacklisted by Cardano Shield</div>
    </v-card-title>
    <v-card-text id="main-content">
      By checking the boxes below, you understand and acknowledge the following:
      <div class="custom-checkbox">
        <input type="checkbox" id="checkbox1" name="checkbox1" v-model="checkbox1" />
        <label for="checkbox1">
          <p>
            This Website is blacklisted or suspected of being malicious and may be impersonating another legitimate
            website.
          </p>
        </label>
      </div>

      <div class="custom-checkbox">
        <input type="checkbox" id="checkbox2" name="checkbox2" v-model="checkbox2" />
        <label for="checkbox2">
          <p>This Website may attempt to steal my funds by presenting false or misleading information</p>
        </label>
      </div>
      <v-row style="justify-content: space-around; margin: 15px 0px">
        <v-btn id="report-btn" @click="reportSite"> Report this site as safe! </v-btn>
      </v-row>
      <v-row style="justify-content: space-between" class="px-4">
        <button class="backsfty-btn" @click="safety">Back to Safety</button>
        <v-btn class="continue-btn" @click="proceed" :disabled="!(checkbox1 && checkbox2)">Continue to site</v-btn>
      </v-row>
    </v-card-text>
  </v-card>
</template>
<script>
export default {
  name: 'WarningPopUp',
  data() {
    return {
      checkbox1: false,
      checkbox2: false,
      suspiciousUrl: null,
    };
  },
  async created() {
    const hash = window.location.hash;
    const [path, query] = hash.substring(1).split('?');
    if (query) {
      const params = new URLSearchParams(query);
      this.suspicious_url = params.get('param');
      // console.log(suspicious_url);
    } else {
      console.log('No query parameters found');
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

        // Close the popup tab
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
                  // console.log('tabs inside', tabs.length);
                  chrome.tabs.update(tab.id, { url: 'https://www.google.com' }, () => {
                    resolve();
                  });
                } else {
                  chrome.tabs.remove(tab.id, () => {
                    resolve();
                  });
                }
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
    },
    async reportSite() {
      chrome.tabs.query({}, async tabs => {
        const navigateToreportPromise = tabs.map(tab => {
          return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: 'checkForOverlay' }, response => {
              if (response && response.hasOverlay) {
                chrome.tabs.sendMessage(tab.id, { action: 'reportSite' }, response => {
                  if (response && response.action === 'navigateToReport') {
                    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('index.html#/report') });
                    localStorage.setItem('intendedUrl', this.suspicious_url);
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
