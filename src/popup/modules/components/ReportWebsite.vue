<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="close"
    title="Report Website"
    :subtitle="`Help us improve Cardano Sheild by reporting scam or making website as safe`"
    :min-height="0"
  >
    <v-card-title style="display: block" class="py-0">
      <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
        <v-stepper-header>
          <template v-for="(item, index) in steps">
            <div
              class="custom-step"
              :key="item.name"
              :class="{
                active: currentStep === index + 1,
                done: currentStep > index + 1,
                next: currentStep < index + 1,
              }"
            >
              <div class="icon-container">
                <v-icon class="step-icon" :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'" size="20"
                  >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                </v-icon>
              </div>
              <span class="step-label">{{ item.label }}</span>
            </div>
            <div
              class="divider"
              :class="{ 'active-divider': currentStep > index + 1 }"
              :key="index"
              v-if="index < steps.length - 1"
            ></div>
          </template>
        </v-stepper-header>
      </v-stepper>
    </v-card-title>
    <v-card-text
      class="px-3 pb-0"
      style="z-index: 1; min-height: 0; height: 490px; align-content: center"
      :style="currentStep === 3 && loggedWallet?.type === WalletType.Normal ? { height: '442px' } : {}"
    >
      <CustomStepper :currentStep="currentStep" :steps="steps">
        <v-stepper-content step="1">
          <v-form ref="form">
            <div class="d-flex justify-space-between mb-1">
              <v-label small class="white--text mr-5">Website (DApp):{{ reportSite }}</v-label>
              <v-select
                v-model="website"
                :items="websites"
                required
                class="select-item width-50"
                hide-details
                outlined
                dense
              ></v-select>
            </div>
            <v-label small class="white--text">Description of the Scam</v-label>
            <textarea
              v-model="description"
              placeholder="Write your description here..."
              required
              class="custom-textarea my-3"
              :maxlength="250"
            ></textarea>
            <v-label small class="white--text mb-2">Evidence</v-label>
            <v-list class="lists mb-1">
              <p class="text-body-2">
                - Attach any screenshots, transaction details, communication logs, or other relevant documents.
              </p>
              <p class="text-body-2">
                - Provide links or references to any external information that supports your claim.
              </p>
            </v-list>
            <textarea
              v-model="evidence"
              required
              placeholder="Write your description here"
              class="mb-4 custom-textarea"
              :maxlength="250"
            ></textarea>
            <!-- <p v-if="wordCount > 250" class="error-message">Maximum word limit is 250.</p>
            <p>Word Count: {{ wordCount }}/250</p> -->
            <p v-if="fileName">{{ fileName }}</p>
            <v-btn @click="triggerFileInput" class="upload-btn mb-1">
              <span>Upload File</span>
              <input type="file" ref="fileInput" @change="onFileChange" style="display: none" accept=".jpg, .jpeg, .png, .pdf, .txt" />
              <v-icon size="30" color="#9c958b">mdi-cloud-arrow-up-outline</v-icon>
            </v-btn>
            <!-- <button class="upload-btn" @click="triggerFileInput">
              <span> Upload File </span>
              <input type="file" @change="onFileChange" style="display: none" ref="fileInput" />
              <v-icon size="30" color="#9c958b">mdi-cloud-arrow-up-outline</v-icon>
              <v-icon v-if="uploadFile" color="#00fad5" class="my-2 ml-2">mdi-check-circle</v-icon>
            </button> -->
          </v-form>
          <div class="d-flex justify-center">
            <v-btn :disabled="!isFormValid" @click="nextStep" class="continue"
              >Continue
              <v-icon size="30" color="#001b19">mdi-arrow-right</v-icon>
            </v-btn>
          </div>
        </v-stepper-content>
        <v-stepper-content step="2">
          <div class="d-flex mb-1">
            <v-label small class="white--text mr-5">Website (DApp):{{ reportSite }}</v-label>
            <p>{{ website }}</p>
          </div>
          <v-label small class="white--text">Description of the Scam</v-label>
          <P>{{ description }}</P>
          <v-label small class="white--text mb-2">Evidence</v-label>
          <p>{{ evidence }}</p>
          <p v-if="fileName">Selected File: {{ fileName }}</p>
          <div class="d-flex justify-center">
            <v-img v-if="uploadFile" :src="uploadFile" max-width="300" class="mt-4"></v-img>
          </div>
          <v-card-actions class="justify-center">
            <!-- <v-btn @click="prevStep">Back</v-btn> -->
            <v-btn class="submit" @click="submitReport"
              >Submit Report
              <v-icon size="30" color="#001b19">mdi-file-document-outline </v-icon>
            </v-btn>
          </v-card-actions>
        </v-stepper-content>
      </CustomStepper>
    </v-card-text>
  </BaseDialog>
</template>

<script>
import CustomStepper from '@/shared/components/CustomStepper.vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';
export default {
  data() {
    return {
      isOpen: true,
      currentStep: 1,
      website: '',
      description: '',
      evidence: '',
      uploadFile: null,
      fileName: '',
      evidanceFile: null,
      websites: ['Not Safe', 'Safe', 'Not Sure'],
      steps: [
        {
          name: 'details',
          label: 'Details',
        },
        {
          name: 'summary',
          label: 'Summary',
        },
      ],
      // wordCount: 0,
    };
  },
  created() {
    this.reportSite = localStorage.getItem('intendedUrl');
  },
  components: {
    CustomStepper,
    BaseDialog,
  },
  computed: {
    isFormValid() {
        if(this.evidence.length>250||this.description.length>250){
          return false;
        }else if(!this.website || !this.description || !this.evidence){
          return false;
        }else{
          return true;
        }
      // return this.website && this.description && this.evidence;
    },
  },
  methods: {
    triggerFileInput() {
      this.$refs.fileInput.click();
    },
    onFileChange(event) {
      const file = event.target.files[0];
      if (file) {
        this.fileName = file.name; // Get the file name
        this.evidanceFile = file; // Store the file
        if (file.type.startsWith('image/')) {
          this.uploadFile = URL.createObjectURL(file);
        } else {
          this.uploadFile = ''; // No preview for PDFs or text files
        }
      } else {
        this.fileName = '';
        this.uploadFile = '';
      }
    },
    // checkWordLimit() {
    //   const words = this.evidence.trim().split(/\s+/);
    //   this.wordCount = words.length;
    //   if (this.wordCount > 250) {
    //     return false;
    //     //   this.evidence = words.slice(0, 250).join(' ');
    //     //   this.wordCount = 250;
    //   } else {
    //     return true;
    //   }
    // },
    nextStep() {
      if (this.isFormValid) {
        this.currentStep++;
      }
    },
    prevStep() {
      this.currentStep--;
    },
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (file) {
        this.evidence = file;
        this.uploadFile = URL.createObjectURL(file);
      }
    },
    close() {
      this.isOpen = false;
      this. clearUrl();
      this.$router.push('/');
      this.$emit('close');
    },
    submitReport() {
      // Handle the form submission
      this.isOpen = false;
      this. clearUrl();
      this.$emit('close');
      this.$router.push('/');
    },
    clearUrl(){
      if(localStorage.getItem('intendedUrl')){
        localStorage.removeItem('intendedUrl');
      }
    }
  },
  watch: {
    isOpen(val) {
      if (!val) {
        this.$emit('close');
      }
    },
  },
};
</script>

<style scoped>
.select-item {
  max-width: 50%;
  border-radius: 4px;
}
.lists {
  background-color: #111212;
}
.compact-list .v-list-item {
  margin-bottom: 4px;
  padding-top: 0;
  padding-bottom: 0;
}
.continue,
.submit {
  margin: 10px 0px;
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;
}

.continue:disabled,
.submit:disabled {
  opacity: 0.5;
  color: black !important;
}

.stepper-container {
  background-color: transparent;
}

.stepper-container .v-stepper__header {
  box-shadow: none;
}
.custom-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding: 5px;
  width: 150px;
}
.custom-step.active .next .icon-container {
  background-color: #292929;
}
.custom-step.active .icon-container {
  box-shadow: 0 0 0 5px #00dff327;
}

.icon-container {
  background-color: #00dff3;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  /* height: 24px;
  width: 24px; */
  padding-left: 1px;
}

.step-label {
  margin-top: 10px;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  font-weight: 600;
  color: #cecfd2;
}

.divider {
  flex: 1;
  height: 2px;
  width: 100%;
  margin-left: -75px;
  margin-right: -75px;
  margin-top: 16px;
  background-color: #292929;
}
.divider.active-divider {
  background-color: #00dff3;
}
.upload-btn {
  width: 180px;
  display: flex;
  align-items: center;
  border: 1px solid #9c958b;
  border-radius: 8px;
  justify-content: space-between;
  padding: 9px;
}
.custom-textarea {
  width: 98%;
    border: 1px solid #9c958b;
    border-radius: 5px;
    padding: 10px 5px;
    color: #fff;
    margin: 0px 3px;

}
/* .error-message {
  color: red;
} 

 .description.v-application--is-ltr .v-textarea.v-text-field--enclosed .v-text-field__slot
{
  height: 50px !important;
}  */
</style>
