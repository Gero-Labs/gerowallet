<template>
  <div class="step-content">
    <div class="modal-header">
      <h2 class="modal-title">{{ $t('navigation.uploadYourId') }}</h2>
      <p class="modal-subtitle">{{ $t('navigation.governmentIdOnly') }}</p>
    </div>

    <div class="upload-section">
      <!-- Show uploaded file if exists -->
      <div v-if="uploadedFileUrl" class="uploaded-file">
        <img :src="uploadedFileUrl" :alt="$t('card.uploadedId')" class="uploaded-image" />
        <div class="file-info">
          <span class="file-name">{{ uploadedFile?.name }}</span>
          <button class="change-file-btn" @click="triggerFileUpload">{{ $t('navigation.changeFile') }}</button>
        </div>
      </div>

      <!-- Upload area if no file -->
      <div v-else class="upload-area" @click="triggerFileUpload" @drop="handleFileDrop" @dragover.prevent>
        <div class="upload-icon">
          <img src="@/modules/wallet/icons/upload.svg" :alt="$t('common.upload')" />
        </div>
        <div class="upload-text">
          <span class="upload-action">{{ $t('navigation.clickToUpload') }}</span>
          <span class="upload-hint">{{ $t('navigation.dragAndDrop') }}</span>
        </div>
        <p class="upload-info">{{ $t('navigation.fileFormatHint') }}</p>
      </div>
      <input ref="fileInput" type="file" accept="image/*" @change="handleFileSelect" style="display: none" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Props {
  uploadedFile: File | null;
  uploadedFileUrl: string;
}

interface Emits {
  (e: 'file-selected', file: File): void;
  (e: 'file-dropped', file: File): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const fileInput = ref<HTMLInputElement>();

const triggerFileUpload = () => {
  fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    emit('file-selected', file);
    console.log('File selected:', file);
  }
};

const handleFileDrop = (event: DragEvent) => {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    emit('file-dropped', file);
    console.log('File dropped:', file);
  }
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.step-content {
  width: 100%;
  padding: $spacing-3xl;
}

.modal-header {
  margin-bottom: $spacing-3xl;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0 0 $spacing-sm 0;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-muted;
  margin: 0;
}

.upload-section {
  width: 100%;
}

.upload-area {
  border: 1px solid $border-secondary;
  border-radius: $border-radius-lg;
  padding: $spacing-lg $spacing-2xl;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-md;
  cursor: pointer;
  transition: border-color var(--g-dur-slow) ease;
}

.upload-area:hover {
  border-color: $border-primary;
}

.upload-icon {
  width: 40px;
  height: 40px;
  background: $background-card;
  border: 1px solid $border-primary;
  border-radius: $border-radius-md;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: $shadow-button;
}

.upload-text {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
}

.upload-action {
  @include text-style($font-size-sm, $font-weight-semibold);
  color: $text-secondary;
}

.upload-hint {
  @include body-text($font-size-sm);
  color: $text-muted;
}

.upload-info {
  @include body-text($font-size-xs);
  color: $text-muted;
  text-align: center;
  margin: 0;
}

.uploaded-file {
  border: 1px solid $border-secondary;
  border-radius: $border-radius-lg;
  padding: $spacing-lg;
  min-height: 169px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-md;
}

.uploaded-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: $border-radius-md;
}

.file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
}

.file-name {
  @include text-style($font-size-sm, $font-weight-semibold);
  color: $text-secondary;
  text-align: center;
}

.change-file-btn {
  background: $background-card;
  border: 1px solid $border-primary;
  border-radius: $border-radius-sm;
  padding: $spacing-xs $spacing-md;
  @include text-style($font-size-xs, $font-weight-semibold);
  color: $text-secondary;
  cursor: pointer;
  transition: color var(--g-dur-slow) ease, border-color var(--g-dur-slow) ease;
}

.change-file-btn:hover {
  border-color: $primary-cyan;
  color: $primary-cyan;
}
</style>
