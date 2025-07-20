<template>
  <section class="application-status-section">
    <div class="status-content">
      <div class="card-container">
        <img src="@/assets/img/card.svg" alt="card" />
      </div>

      <div class="status-info">
        <div class="icon-and-text">
          <div class="featured-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M11.998 12L7.72516 8.43926C7.09031 7.91022 6.77289 7.6457 6.54469 7.32144C6.34249 7.03413 6.19234 6.71354 6.10106 6.37428C5.99805 5.99139 5.99805 5.57819 5.99805 4.7518V2M11.998 12L16.2709 8.43926C16.9058 7.91022 17.2232 7.6457 17.4514 7.32144C17.6536 7.03413 17.8038 6.71354 17.895 6.37428C17.998 5.99139 17.998 5.57819 17.998 4.7518V2M11.998 12L7.72516 15.5607C7.09031 16.0898 6.77289 16.3543 6.54469 16.6786C6.34249 16.9659 6.19234 17.2865 6.10106 17.6257C5.99805 18.0086 5.99805 18.4218 5.99805 19.2482V22M11.998 12L16.2709 15.5607C16.9058 16.0898 17.2232 16.3543 17.4514 16.6786C17.6536 16.9659 17.8038 17.2865 17.895 17.6257C17.998 18.0086 17.998 18.4218 17.998 19.2482V22M3.99805 2H19.998M3.99805 22H19.998"
                stroke="#00DFF3"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="heading-and-supporting-text">
            <h3 class="heading">We're reviewing your application</h3>
            <p class="supporting-text">
              Thanks for submitting your details. Our team is reviewing your application and will get back to you
              shortly. You'll receive an email as soon as there's an update.
            </p>
          </div>
        </div>
        <SecondaryButton text="Contact Support" @click="handleContactSupport" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import SecondaryButton from './SecondaryButton.vue';

const handleContactSupport = () => {
  // Handle contact support logic
  console.log('Contact support clicked');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.application-status-section {
  padding: 64px;
  border-radius: 8px;
  border: 1px solid #1f242f;
  background: linear-gradient(100deg, #00e4f9 -35.87%, #162d2f 40.02%, #121212 84.89%);
}

.status-content {
  display: flex;
  align-items: center;
  gap: 60px;
  padding: 32px 0;
}

.card-container {
  flex-shrink: 0;
}

.credit-card-mockup {
  position: relative;
  width: 428px;
  height: 258px;
  background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
  border-radius: 25px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.card-strip {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 130px;
  background: #252b37;
  opacity: 0.79;
}

.payment-method-icon {
  position: absolute;
  bottom: 22px;
  right: 22px;
  width: 62px;
  height: 43px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mastercard-icon {
  position: relative;
  width: 40px;
  height: 24px;
}

.mastercard-left {
  position: absolute;
  left: 0;
  top: 0;
  width: 24px;
  height: 24px;
  background: #dadada;
  border-radius: 50%;
  opacity: 0.5;
}

.mastercard-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 20px;
  height: 24px;
  background: linear-gradient(135deg, #f9a000 0%, #6d6dbb 100%);
  border-radius: 50%;
  opacity: 0.5;
}

.mastercard-middle {
  position: absolute;
  left: 16px;
  top: 3px;
  width: 9px;
  height: 18px;
  background: #ffffff;
  border-radius: 4px;
}

.card-number {
  position: absolute;
  bottom: 52px;
  left: 22px;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  font-size: 22px;
  color: white;
  letter-spacing: 2px;
}

.cardholder {
  position: absolute;
  bottom: 85px;
  left: 22px;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: white;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.expiry {
  position: absolute;
  bottom: 85px;
  right: 22px;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: white;
  letter-spacing: 1px;
}

.paypass-icon {
  position: absolute;
  top: 27px;
  right: 27px;
  color: white;
}

.gero-logo {
  position: absolute;
  top: 14px;
  left: 14px;
  width: 63px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-placeholder {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 560px;
}

.icon-and-text {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.featured-icon {
  width: 48px;
  height: 48px;
  background: rgba(0, 223, 243, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.heading-and-supporting-text {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.heading {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 30px;
  color: #f7f7f7;
  margin: 0;
  line-height: 1.27;
}

.supporting-text {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 18px;
  color: #94979c;
  margin: 0;
  line-height: 1.56;
}

@media (max-width: 1024px) {
  .status-content {
    flex-direction: column;
    gap: 40px;
    text-align: center;
  }

  .credit-card-mockup {
    width: 360px;
    height: 220px;
  }

  .heading {
    font-size: 26px;
  }

  .supporting-text {
    font-size: 16px;
  }
}

@media (max-width: 768px) {
  .application-status-section {
    padding: 60px 0;
  }

  .credit-card-mockup {
    width: 320px;
    height: 200px;
  }

  .card-number {
    font-size: 18px;
  }

  .cardholder,
  .expiry {
    font-size: 14px;
  }

  .heading {
    font-size: 24px;
  }

  .supporting-text {
    font-size: 15px;
  }
}
</style>
