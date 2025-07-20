<template>
  <div class="feature-card">
    <div class="feature-icon">
      <svg
        v-if="icon === 'global'"
        xmlns="http://www.w3.org/2000/svg"
        width="25"
        height="24"
        viewBox="0 0 25 24"
        fill="none"
      >
        <path
          d="M3.57598 7.48282L7.86402 10.5457C8.08715 10.705 8.19872 10.7847 8.31548 10.8031C8.41821 10.8192 8.52343 10.8029 8.61648 10.7565C8.72223 10.7037 8.80449 10.594 8.96901 10.3747L9.87511 9.16652C9.92164 9.10448 9.9449 9.07347 9.97224 9.04671C9.99652 9.02295 10.0232 9.00173 10.0517 8.98338C10.0839 8.9627 10.1193 8.94696 10.1902 8.91546L14.0588 7.19609C14.2192 7.12482 14.2993 7.08918 14.3598 7.03352C14.4133 6.9843 14.4554 6.924 14.4832 6.85684C14.5146 6.78091 14.5204 6.69336 14.5321 6.51826L14.8154 2.2694M14 13.5L16.616 14.6211C16.9195 14.7512 17.0713 14.8163 17.1517 14.9243C17.2222 15.0191 17.2569 15.1358 17.2496 15.2537C17.2413 15.3881 17.1497 15.5255 16.9665 15.8002L15.7375 17.6438C15.6507 17.774 15.6072 17.8391 15.5499 17.8863C15.4991 17.928 15.4406 17.9593 15.3777 17.9784C15.3067 18 15.2284 18 15.0719 18H13.0766C12.8693 18 12.7656 18 12.6774 17.9653C12.5995 17.9347 12.5305 17.885 12.4768 17.8208C12.416 17.7481 12.3832 17.6497 12.3177 17.453L11.6048 15.3144C11.5661 15.1983 11.5468 15.1403 11.5417 15.0814C11.5372 15.0291 11.5409 14.9764 11.5528 14.9253C11.5662 14.8677 11.5935 14.813 11.6482 14.7036L12.1897 13.6206C12.2997 13.4005 12.3547 13.2905 12.4395 13.2222C12.5141 13.162 12.6046 13.1246 12.6999 13.1143C12.8081 13.1027 12.9248 13.1416 13.1582 13.2194L14 13.5ZM22.5 12C22.5 17.5228 18.0228 22 12.5 22C6.97715 22 2.5 17.5228 2.5 12C2.5 6.47715 6.97715 2 12.5 2C18.0228 2 22.5 6.47715 22.5 12Z"
          stroke="#CECFD2"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg
        v-if="icon === 'conversion'"
        width="25"
        height="24"
        viewBox="0 0 25 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6.5 6L8.5 4M8.5 4L6.5 2M8.5 4H6.5C4.29086 4 2.5 5.79086 2.5 8M18.5 18L16.5 20M16.5 20L18.5 22M16.5 20H18.5C20.7091 20 22.5 18.2091 22.5 16M10.689 6.5C11.3551 3.91216 13.7042 2 16.5 2C19.8137 2 22.5 4.68629 22.5 8C22.5 10.7957 20.5879 13.1449 18.0001 13.811M14.5 16C14.5 19.3137 11.8137 22 8.5 22C5.18629 22 2.5 19.3137 2.5 16C2.5 12.6863 5.18629 10 8.5 10C11.8137 10 14.5 12.6863 14.5 16Z"
          stroke="#CECFD2"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg
        v-if="icon === 'track'"
        width="25"
        height="24"
        viewBox="0 0 25 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M11.5 3H8.3C6.61984 3 5.77976 3 5.13803 3.32698C4.57354 3.6146 4.1146 4.07354 3.82698 4.63803C3.5 5.27976 3.5 6.11984 3.5 7.8V16.2C3.5 17.8802 3.5 18.7202 3.82698 19.362C4.1146 19.9265 4.57354 20.3854 5.13803 20.673C5.77976 21 6.61984 21 8.3 21H16.7C18.3802 21 19.2202 21 19.862 20.673C20.4265 20.3854 20.8854 19.9265 21.173 19.362C21.5 18.7202 21.5 17.8802 21.5 16.2V13M12.5 8H16.5V12M16 3.5V2M19.9393 4.56066L21 3.5M21.0103 8.5H22.5103M3.5 13.3471C4.15194 13.4478 4.81987 13.5 5.5 13.5C9.88636 13.5 13.7653 11.3276 16.1197 8"
          stroke="#CECFD2"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <div class="feature-card-content">
      <h4 class="feature-title">{{ title }}</h4>
      <p class="feature-description">{{ description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  icon: 'conversion' | 'global' | 'track';
  title: string;
  description: string;
}

defineProps<Props>();
</script>

<style scoped>
.feature-card {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.feature-icon {
  margin: 0 auto;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #373a41;
  background: #0c0e12;
  box-shadow: 0px 0px 0px 1px rgba(12, 14, 18, 0.18) inset, 0px -2px 0px 0px rgba(12, 14, 18, 0.05) inset,
    0px 1px 2px 0px rgba(255, 255, 255, 0);
}

.feature-card-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feature-title {
  font-size: 20px;
  font-weight: 600;
  color: white;
  line-height: 1.3;
}

.feature-description {
  font-size: 16px;
  color: #94979c;
  line-height: 1.6;
}
</style>
