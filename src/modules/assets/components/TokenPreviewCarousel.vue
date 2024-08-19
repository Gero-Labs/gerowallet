<template>
  <div>
    <div class="carousel-container">
      <div class="carousel">
        <div v-for="(image, index) in visibleSlides" :key="index" class="carousel-item" :class="getSlideClass(index)">
          <img :src="require(`../assets/${image}`)" alt="token" class="carousel-image" />
          <v-btn v-if="index===2" class="nav-arrow" @click="nextSlide" icon><v-icon size="30" color="#9c958b">mdi-arrow-right</v-icon></v-btn>
          <v-btn v-if="index===0" class="nav-arrow" @click="prevSlide" icon ><v-icon size="30" color="#9c958b">mdi-arrow-left</v-icon></v-btn>
        </div>
      </div>
    </div>
    <div class="d-flex flex-column justify-center align-center">
      <div class="info-container">
        <span class="info-label">Fingerprint: </span>
        <span class="info-value">{{ fingerprint }}</span>
        <CopyButton v-if="fingerprint" small color="#94969c" :value="fingerprint" />
      </div>
      <div class="info-container">
        <span class="info-label">Asset Name:</span>
        <span class="info-value">{{ asset }}</span>
        <CopyButton v-if="asset" small color="#94969c" :value="asset" />
      </div>
    </div>
    <div class="navigation-links">
      <div class="pool-button-linear">
        <a class="nav-button ">View in Pool.pm</a>
      </div>
      <div class="jpg-button-linear">
        <a class="nav-button jpg-button">View in jpg.store</a>
      </div>
    </div>
  </div>
</template>

<script>
import CopyButton from '@/shared/components/CopyButton.vue';

export default {
  components: { CopyButton },
  data() {
    return {
      asset: "696d656e73696f6e426f78202330303436",
      fingerprint: "asset14rqgvn5qjuqz4fsyajvre7kcdjdshp2cjjh42w",
      images: ["2.png", "4.png", "5.png", "6.png", "8.png", "9.png", "66.png"],
      currentIndex: 0,
    };
  },
  computed: {
    visibleSlides() {
      const totalImages = this.images.length;
      const leftIndex = (this.currentIndex - 1 + totalImages) % totalImages;
      const rightIndex = (this.currentIndex + 1) % totalImages;
      return [this.images[leftIndex], this.images[this.currentIndex], this.images[rightIndex]];
    },
  },
  methods: {
    nextSlide() {
      this.currentIndex = (this.currentIndex + 1) % this.images.length;
    },
    prevSlide() {
      this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
    },
    getSlideClass(index) {
      switch (index) {
        case 0:
          return "left";
        case 1:
          return "center";
        case 2:
          return "right";
        default:
          return "";
      }
    },
  },
};
</script>

<style scoped>
.carousel-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 450px;
}

.nav-arrow {
  cursor: pointer;
  font-size: 24px;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.carousel {
  display: flex;
  overflow: hidden;
  width: 100%;
  height: 100%;
  gap: 20px;
  justify-content: center;
  align-items: center;
}

.carousel-item {
  position: relative;
  text-align: center;
  transition: all 0.5s ease;
}

.carousel-image {
  width: 100%;
}

.carousel-item.center {
  width: 40%;
}

.carousel-item.left,
.carousel-item.right {
  height: 50%;
  width: 15%;

  & .carousel-image {
    height: 100%;
    opacity: 0.4;
    object-fit: cover;
    object-position: center;
  }
}

.info-container{
  display: flex;
  justify-content: space-between;
  align-items: center;


  .info-label{
    width: 100px;
  }

  .info-value{
   width: 300px;
  }


  .info-label, .info-value{
    color: #94969c;
    font-size: 12px;
  }
}


.navigation-links{
  display: flex;
  justify-content: center;
  gap: 50px;
  margin-top: 20px;
  flex-wrap: wrap;


  .nav-button{
    background-color: #0f0f0f;
    padding: 10px;
    font-size:16px;
    color: white;
    border-radius: 8px;
    transition: all 0.3s ease;

    &:hover{
      opacity: 0.9;
    }
  }

  .pool-button-linear, .jpg-button-linear{
    padding: 9px 1px;
    position: relative;
    border-radius: 8px;
  }

  .pool-button-linear{
    background: linear-gradient(to right,#9F27AE , #E91E63);
  }
  .jpg-button-linear{
    background: linear-gradient(to right,#FFC900 , #FFFFFF);
  }
}

</style>
