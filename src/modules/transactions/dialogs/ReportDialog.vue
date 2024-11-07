<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="Report Website"
    subtitle="Improve Cardano Shield by letting us know if a website is fraudulent or trustworthy."
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
              <v-label small class="white--text" style="align-content: center;">Website: {{ reportSite }}</v-label>
            </div>
            <v-select
              v-model="website"
              :items="websites"
              label="Mark as "
              required
              class="select-item width-50"
              hide-details
              outlined
              dense
            ></v-select>
            <v-textarea
              label="Description of the Scam"
              rows="3"
              outlined
              v-model="description"
              placeholder="Write your description here..."
              required
              class="mt-3"
              :maxlength="250"
              counter
            ></v-textarea>
            <v-list class="transparent py-0">
              <p>
                - Attach any screenshots, transaction details, communication logs, or other relevant documents.
              </p>
              <p>
                - Provide links or references to any external information that supports your claim.
              </p>
            </v-list>
            <v-textarea
              outlined
              rows="3"
              v-model="evidence"
              label="Evidence"
              required
              placeholder="Write your evidence here..."
              :maxlength="250"
              counter
            ></v-textarea>
            <v-file-input
              dense hide-details
              outlined type="file"
              ref="fileInput"
              @change="onFileChange"
              accept=".jpg, .jpeg, .png, .pdf, .txt"
              color="primary"
              counter
              :show-size="1000"
            >
              <template v-slot:selection="{ text }">
                <v-chip
                  color="primary"
                  dark
                  label
                  small
                >
                  {{ text }}
                </v-chip>
              </template>
            </v-file-input>
          </v-form>
        </v-stepper-content>
        <v-stepper-content step="2">
          <div class="d-flex mb-1">
            <v-label small class="white--text pr-1" style="align-content: center;">Website: {{ reportSite }}</v-label>
            <v-chip small outlined>{{website}}</v-chip>
          </div>
          <v-label small class="white--text">Description of the Scam</v-label>
          <P>{{ description }}</P>
          <v-label small class="white--text mb-2">Evidence</v-label>
          <p>{{ evidence }}</p>
          <p v-if="uploadFile" class="mb-0">Selected File: {{ uploadFile.name }}</p>
          <div class="d-flex justify-center">
            <v-img v-if="imageUrl" :src="imageUrl" max-width="300" class="mt-4"></v-img>
          </div>
        </v-stepper-content>
      </CustomStepper>
    </v-card-text>
    <v-card-actions>
      <v-btn text v-if="currentStep === 2" @click="prevStep">
        <v-icon small class="mr-1">mdi-arrow-left</v-icon>
        Back
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn v-if="currentStep === 1" :disabled="!isFormValid" @click="nextStep" class="geroButton" style="color: black!important; text-transform: uppercase">
        Continue
        <v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
      </v-btn>
      <v-btn v-if="currentStep === 2" @click="submitReport" class="geroButton" style="color: black!important; text-transform: uppercase">
        Submit Report
        <v-icon style="color: black!important;" small class="ml-1">mdi-file-document-outline</v-icon>
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import CustomStepper from '@/shared/components/CustomStepper.vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';

export default {
  name: "ReportDialog",
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    reportSite: {
      type: String
    },
  },
  components: {
    CustomStepper,
    BaseDialog,
  },
  computed: {
    isFormValid() {
        if (this.evidence.length>250||this.description.length>250) {
          return false;
        } else if (!this.website || !this.description || !this.evidence) {
          return false;
        } else {
          return true;
        }
    },
  },
  methods: {
    onFileChange(file) {
      if (!file) {
        this.uploadFile = null
        this.imageUrl = ''
        return;
      }
      this.uploadFile = file
      this.createImage(file);
    },
    createImage(file) {
      const reader = new FileReader();

      reader.onload = e => {
        this.imageUrl = e.target.result;
      };
      reader.readAsDataURL(file);
    },
    nextStep() {
      if (this.isFormValid) {
        this.currentStep++;
      }
    },
    prevStep() {
      this.currentStep--;
    },
    submitReport() {
      this.$emit('close');
    }
  },
  watch: {
    isOpen(val) {
      if (!val) {
        this.$emit('close');
      }
    },
  },
  data() {
    return {
      currentStep: 1,
      imageUrl: '',
      website: '',
      description: '',
      evidence: '',
      uploadFile: null,
      evidenceFile: null,
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
    };
  },
};
</script>

<style scoped>
.select-item {
  max-width: 50%;
  border-radius: 4px;
}

.compact-list .v-list-item {
  margin-bottom: 4px;
  padding-top: 0;
  padding-bottom: 0;
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
</style>
