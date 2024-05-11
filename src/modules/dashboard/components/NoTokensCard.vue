<template>
  <v-card outlined class="card-container">
    <v-card-title class="subtitle-1">Welcome to Gero Dashboard</v-card-title>

    <section v-if="!hasApex" class="mb-10">
      <p class="display-1">Let's start by getting some Ap3x into your wallet!</p>
      <p class="subtitle-1">Claim your Ap3x tokens with your Cardano Wallet by using the DApp below</p>
      <v-btn class="claim-apex-button"></v-btn>
    </section>

    <section
      class="text-center d-flex align-center justify-center flex-column stake-apex-section"
      :class="{ 'no-apex': !hasApex }"
    >
      <div class="stake-apex-info">
        <h1 class="display-1">Stake Your Ap3x and Earn Rewards</h1>
        <v-card-text class="subtitle-1"
          >Earn rewards by staking your Ap3x tokens with Apex Fusion's extensive network of stake pools.</v-card-text
        >
        <p class="subtitle-1 support-us-text">
          Consider supporting us by delegating your stake to GERO and start earning as soon as current epoch!
        </p>

        <div class="d-flex align-center justify-center flex-column">
          <v-btn class="stake-button-gero">Stake with GERO</v-btn>
          <v-btn class="stake-button-pools">Browse Stake Pools</v-btn>
        </div>
      </div>

      <h2 class="error-message">You need to have Ap3x in your wallet before staking!</h2>
    </section>
  </v-card>
</template>
<script>
export default {
  props: {
    hasApex: {
      type: Boolean,
      default: false,
    },
  },
};
</script>
<style scoped>
.card-container {
  display: flex;
  align-items: center;
  text-align: center;
  flex-direction: column;
  padding: 0 20px;
  height: 100%;

  .claim-apex-button {
    width: 320px;
    opacity: 0.7;
    height: 110px;
    transition: 0.2s all ease-in-out;
    background-image: url('../assets/claim_ap3x_button.png');
    background-size: contain;

    &:hover {
      opacity: 1;
    }

    & img {
      box-shadow: 0px 5px 10px 7px rgba(0, 0, 0, 0.5);
      height: 100%;
      width: 100%;
    }
  }

  .stake-apex-section {
    .support-us-text {
      color: #00dff3;
    }

    .stake-button-gero,
    .stake-button-pools {
      margin: 10px 0;
      width: 200px;
      font-family: Inter;
      font-size: 12px;
    }

    .stake-button-gero {
      background: linear-gradient(to right, #00c7f3, #00ffd1);
      color: black;
    }

    .stake-button-pools {
      border: 1px solid #ffffff;
      background-color: transparent !important;
    }

    .error-message {
      position: absolute;
      color: #ff7777;
      padding: 10px;
      display: none;
      &:hover {
        display: block;
      }
    }

    &.no-apex {
      .stake-apex-info {
        opacity: 0.2;
        pointer-events: none;
      }

      &:hover {
        .stake-apex-info {
          filter: blur(4px);
        }

        & > .error-message {
          display: block;
        }
      }
    }
  }
}
</style>
