<template>
  <BaseDialog
    :img="require('@/assets/svg/cardano_shield_logo.svg')"
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="'Report '+ (reportSite ? 'Website' : 'Transaction')"
    :subtitle="'Improve Cardano Shield by letting us know if a '+ (reportSite ? 'website' : 'transaction') + ' is fraudulent or trustworthy.'"
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
          <v-form ref="form" v-model="valid" >
            <div class="d-flex mb-1" v-if="reportSite">
              <v-label small class="white--text pr-1" style="align-content: center;">Website:</v-label>
              {{ reportSite }}
            </div>
            <div class="d-flex mb-3" v-if="reportTx">
              <v-label small class="white--text" style="align-content: center;">Transaction ID:</v-label>
              <div>
                <a class="ml-1" style="color: #00DFF3; align-items: center;" :href="`https://cexplorer.io/tx/${reportTx}`" target="_blank">{{ reportTx | truncate }}</a>
                <CopyButton x-small :value="reportTx" class="ml-1"></CopyButton>
              </div>
            </div>
            <v-select
              v-model="label"
              :items="labels"
              label="Mark as "
              class="select-item width-50 mb-4"
              required
              hide-details
              :rules="[rules.required]"
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
              :maxlength="250"
              counter
              :rules="[rules.required, rules.maxCharacters(250)]"
            ></v-textarea>
            <v-textarea
              outlined
              rows="3"
              v-model="evidence"
              label="Evidence"
              required
              placeholder="Write your evidence here..."
              :maxlength="250"
              :rules="[rules.required, rules.maxCharacters(250)]"
              counter
            ></v-textarea>
            <v-list class="transparent py-0">
              <div>
                - Attach any screenshots, transaction details, communication logs, or other relevant documents.
              </div>
              <div>
                - Provide links or references to any external information that supports your claim.
              </div>
            </v-list>
            <v-file-input
              class="mt-4"
              v-model="uploadFile"
              dense hide-details
              outlined type="file"
              ref="fileInput"
              @change="onFileChange"
              label="Reference File"
              accept=".jpg, .jpeg, .png, .webp"
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
          <div class="mb-1" style="align-items: center;">
            <v-label v-if="reportSite" small class="grey--text pr-1" style="align-content: center;">Website</v-label>
            <p class="d-flex" v-if="reportSite" style="align-items: center;">
              {{ reportSite }}
              <v-chip class="ml-1" x-small outlined :color="label === 'Not Safe' ? 'error' : 'success'">{{label}}</v-chip>
            </p>
            <v-label small class="grey--text" style="align-content: center;" v-if="reportTx">Transaction ID</v-label>
            <p class="d-flex" v-if="reportTx" style="align-items: center;">
              <a class="ml-1" style="color: #00DFF3; align-items: center;" :href="`https://cexplorer.io/tx/${reportTx}`" target="_blank">{{ reportTx | truncate }}</a>
              <CopyButton x-small :value="reportTx" class="ml-1"></CopyButton>
              <v-chip class="ml-1" x-small outlined :color="label === 'Not Safe' ? 'error' : 'success'">{{label}}</v-chip>
            </p>
          </div>
          <v-label small class="grey--text">Description of the Scam</v-label>
          <p>{{ description }}</p>
          <v-label small class="grey--text mb-2">Evidence</v-label>
          <p>{{ evidence }}</p>
          <p v-if="uploadFile" class="mb-0">Selected File: {{ uploadFile.name }}</p>
          <div class="d-flex justify-center">
            <v-img v-if="imageUrl" :src="imageUrl" max-width="300" class="mt-4"></v-img>
          </div>
        </v-stepper-content>
      </CustomStepper>
    </v-card-text>
    <v-card-actions>
      <v-btn text v-if="currentStep === 2" @click="prevStep" :disabled="loading">
        <v-icon small class="mr-1">mdi-arrow-left</v-icon>
        Back
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn v-if="currentStep === 1" :disabled="!valid" @click="nextStep" class="geroButton" style="color: black!important; text-transform: uppercase">
        Continue
        <v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
      </v-btn>
      <v-btn v-if="currentStep === 2" @click="submitReport" :loading="loading" class="geroButton" style="color: black!important; text-transform: uppercase">
        Submit Report
        <v-icon style="color: black!important;" small class="ml-1">mdi-file-document-outline</v-icon>
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import CustomStepper from '@/shared/components/CustomStepper.vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import rules from '@/shared/utils/rules';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { ReportLabel, ReportType } from '@/models/cardano-shield-types';
import snackbar from '@/plugins/snackbar';
import { AxiosError } from 'axios';

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
    reportTx: {
      type: String
    }
  },
  components: {
    CopyButton,
    CustomStepper,
    BaseDialog,
  },
  filters,
  methods: {
    onFileChange(file) {
      const maxSize = 3 * 1024 * 1024; // 3 MB
      if (file && file.size > maxSize) {
        alert("File is too large. Maximum size is 3 MB.");
        this.uploadFile = null;
        return;
      }
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
      if (this.$refs.form.validate()) {
        this.currentStep++;
      }
    },
    prevStep() {
      this.currentStep--;
    },
    clearForm() {
      this.title = ''
      this.description = ''
      this.evidence = ''
      this.label = 'Not Safe'
      this.reference = null
      this.currentStep = 1
      this.imageUrl = ''
      this.uploadFile = null
      if (this.$refs.fileInput) {
        this.$refs.fileInput.reset();
      }
      this.$refs.form.resetValidation();
    },
    async submitReport() {
      this.loading = true
      const reportType = this.reportTx ? ReportType.transaction : ReportType.web;
      const reportTypeStr = reportType === ReportType.transaction ? "Transaction" : "Website"
      const ref = this.reportTx ? this.reportTx : this.reportSite;

      const formData = new FormData();
      formData.append("title", reportTypeStr + " Report - " + ref);
      formData.append("description", this.description);
      formData.append("evidence", this.evidence);
      formData.append("type", ReportType[reportType]);
      formData.append("label", ReportLabel[this.label === 'Safe' ? ReportLabel.safe : ReportLabel.scam]); // Convert to backend-compatible format

      if (this.uploadFile) {
        formData.append("reference", this.uploadFile);
      }
      try {
        await cardanoShieldApi.submitReport(formData)
        this.$emit('close');
        this.clearForm()
        snackbar.fireSuccess('Report Submitted Successfully!')
      } catch (e) {
        if (e instanceof AxiosError && e.status === 409) {
          snackbar.setError(reportTypeStr+' Already Reported!')
        } else {
          console.error(e)
          snackbar.setError(e.message)
        }
      } finally {
        this.loading = false
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
  data() {
    return {
      rules,
      currentStep: 1,
      imageUrl: '',
      label: 'Not Safe',
      description: '',
      evidence: '',
      uploadFile: null,
      labels: ['Not Safe', 'Safe'],
      valid: false,
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
      loading: false,
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
