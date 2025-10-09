<template>
  <BaseDialog
    :img="cardanoShieldLogo"
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="'Report '+ (reportSite ? 'Website' : 'Transaction')"
    :subtitle="'Improve Cardano Shield by letting us know if a '+ (reportSite ? 'website' : 'transaction') + ' is fraudulent or trustworthy.'"
    :min-height="0"
    :persistent="false"
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
                <a class="ml-1" style="color: #00DFF3; align-items: center;" :href="`https://cexplorer.io/tx/${reportTx}`" target="_blank">{{ truncate(reportTx) }}</a>
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
              :rules="[rules.required()]"
              outlined
              dense
              attach
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
              :rules="[rules.required(), rules.maxCharacters(250)]"
            ></v-textarea>
            <v-textarea
              outlined
              rows="3"
              v-model="evidence"
              label="Evidence"
              required
              placeholder="Write your evidence here..."
              :maxlength="250"
              :rules="[rules.required(), rules.maxCharacters(250)]"
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
              <a class="ml-1" style="color: #00DFF3; align-items: center;" :href="`https://cexplorer.io/tx/${reportTx}`" target="_blank">{{ truncate(reportTx) }}</a>
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
<script setup lang="ts">
import { ref, watch } from 'vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import rules from '@/utils/rules';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { ReportLabel, ReportType } from '@/models/cardano-shield-types';
import snackbar from '@/plugins/snackbar';
import { AxiosError } from 'axios';
import assets from '@/utils/assets';
import { WalletType } from '@/models/types';

const props = defineProps({
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
});

const emit = defineEmits(['close']);

const { truncate } = filters;

const cardanoShieldLogo = assets.cardanoShieldLogo;
const currentStep = ref(1);
const imageUrl = ref('');
const label = ref('Not Safe');
const description = ref('');
const evidence = ref('');
const uploadFile = ref<File | null>(null);
const labels = ['Not Safe', 'Safe'];
const valid = ref(false);
const loading = ref(false);
const form = ref<any>(null);
const fileInput = ref<any>(null);

const steps = [
  {
    name: 'details',
    label: 'Details',
  },
  {
    name: 'summary',
    label: 'Summary',
  },
];

// Mock loggedWallet for the template - you might need to import actual store
const loggedWallet = ref({ type: WalletType.Normal });

const onFileChange = (file: File | null) => {
  const maxSize = 3 * 1024 * 1024; // 3 MB
  if (file && file.size > maxSize) {
    alert("File is too large. Maximum size is 3 MB.");
    uploadFile.value = null;
    return;
  }
  if (!file) {
    uploadFile.value = null;
    imageUrl.value = '';
    return;
  }
  uploadFile.value = file;
  createImage(file);
};

const createImage = (file: File) => {
  const reader = new FileReader();

  reader.onload = (e) => {
    imageUrl.value = e.target?.result as string;
  };
  reader.readAsDataURL(file);
};

const nextStep = () => {
  if (form.value.validate()) {
    currentStep.value++;
  }
};

const prevStep = () => {
  currentStep.value--;
};

const clearForm = () => {
  description.value = '';
  evidence.value = '';
  label.value = 'Not Safe';
  currentStep.value = 1;
  imageUrl.value = '';
  uploadFile.value = null;
  if (fileInput.value) {
    fileInput.value.reset();
  }
  form.value.resetValidation();
};

const submitReport = async () => {
  loading.value = true;
  const reportType = props.reportTx ? ReportType.transaction : ReportType.web;
  const reportTypeStr = reportType === ReportType.transaction ? "Transaction" : "Website";
  const ref = props.reportTx ? props.reportTx : props.reportSite;

  const formData = new FormData();
  formData.append("title", reportTypeStr + " Report - " + ref);
  formData.append("description", description.value);
  formData.append("evidence", evidence.value);
  formData.append("type", ReportType[reportType]);
  formData.append("label", ReportLabel[label.value === 'Safe' ? ReportLabel.safe : ReportLabel.scam]);

  if (uploadFile.value) {
    formData.append("reference", uploadFile.value);
  }
  try {
    await cardanoShieldApi.submitReport(formData);
    emit('close');
    clearForm();
    snackbar.fireSuccess('Report Submitted Successfully!');
  } catch (e) {
    if (e instanceof AxiosError && e.status === 409) {
      snackbar.setError(reportTypeStr + ' Already Reported!');
    } else {
      console.error(e);
      snackbar.setError((e as Error).message);
    }
  } finally {
    loading.value = false;
  }
};

watch(() => props.isOpen, (val) => {
  if (!val) {
    emit('close');
  }
});
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
