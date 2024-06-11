<template>
  <div class="assets-to-send-container">
    <div class="sections-container">
      <section class="selectors-container">
        <SwapCurrencySelector></SwapCurrencySelector>
        <SwapCurrencySelector></SwapCurrencySelector>
        <v-btn text class="add-token-button"
          ><v-icon class="plus-icon" color="#00c7f3" size="20">mdi-plus</v-icon>Add token</v-btn
        >
      </section>

      <section class="collectibles">
        <h4>Choose Collectibles (5)</h4>
        <v-text-field
          v-model="search"
          placeholder="Search for collectibles"
          outlined
          dense
          hide-details
          class="mb-4"
        ></v-text-field>

        <div v-for="collectible in collectibles" :key="collectible.name" class="collectibles-collection">
          <h5>{{ collectible.name }}</h5>

          <div class="collectible-items">
            <div
              v-for="item in collectible.collectibles"
              :key="item.name"
              class="collectible-item"
              :style="{ backgroundImage: `url(${item.image})` }"
              @click="$emit('select', item)"
            >
              <v-icon v-if="sendData.selectedCollectibles[item.name]" class="check-icon" size="12" color="#000000">mdi-check</v-icon>

              <div class="collectible-text-container">
                <span class="collectible-text">{{ item.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <v-btn class="continue-button" @click="$emit('next')">Continue <v-icon>mdi-arrow-right</v-icon></v-btn>
  </div>
</template>

<script>
import SwapCurrencySelector from "@/shared/components/SwapCurrencySelector.vue";
import {mapState} from "pinia";
import {useStore} from "@/store";

export default {
  components: { SwapCurrencySelector },
  props: {
    sendData: {
      type: Object,
      default: () => ({}),
    },
  },
  name: "AssetsToSendStep",
  computed: {
    ...mapState(useStore, ['calculatedUtxos', 'assets']),
  },
  data() {
    return {
      search: '',
      collectibles: [
        {
          name: "MusicBox Dimensions (30)",
          collectibles: [
            {
              name: "MusicBox Dimensions #1",
              image:
              "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #2",
              image:
              "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #3",
              image:
              "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #4",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #5",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
          ],
        },
        {
          name: "Another dimensions (5)",
          collectibles: [
            {
              name: "MusicBox Dimensions #6",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #7",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #38",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #49",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
            {
              name: "MusicBox Dimensions #35",
              image:
                "https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=100w%20100w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=300w%20300w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=500w%20500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=750w%20750w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1000w%201000w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=1500w%201500w,%20https://images.squarespace-cdn.com/content/v1/636033e6687115383adc8ea7/05a252e6-8cde-4bf4-8547-c0a60dd5d13e/HOOD.png?format=2500w%202500w",
              quantity: 1,
              price: 0.0001,
            },
          ],
        },
      ],
    };
  },
  methods: {
  },
  mounted() {
    // Code to run when the component is mounted goes here
  },
};
</script>

<style scoped>
.assets-to-send-container {
  align-items: center;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  margin-top: 20px;

  .continue-button {
    background: linear-gradient(to right, #00c7f3, #00fad5);
    color: black;
  }

  .sections-container {
    display: flex;
    gap: 40px;
    height: 400px;
    margin-bottom: 50px;
  }

  .selectors-container {
    display: flex;
    flex-direction: column;
    gap: 40px;

    .add-token-button {
      width: fit-content;
      align-self: center;

      .plus-icon {
        border: 2px solid #00c7f3;
        border-radius: 5px;
        margin-right: 10px;
      }
    }
  }

  .collectibles {
    background-color: #0f0f0f;
    border: 2px solid #292929;
    width: 70%;
    overflow-y: auto;
    padding: 10px;

    .collectibles-collection {
      margin-top: 20px;

      .collectible-items {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: space-between;

        .collectible-item {
          width: calc(25% - 6px);
          height: 75px;
          background-size: cover;
          border: 2px solid  transparent;
          display: flex;
          align-items: flex-end;
          box-shadow: inset 1px -20px 10px 0px rgba(0, 0, 0, 0.5);
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          position: relative;


          &:hover {
            border: 2px solid #00c7f3;
          }

          .check-icon{
            position: absolute;
            left: 5px;
            top: 0;
            background-color: #00c7f3;
            border-radius: 50%;
          }

          .collectible-text-container {
            text-overflow: ellipsis;
            overflow: hidden;
            white-space: nowrap;

            .collectible-text {
              font-size: 10px;
              text-align: center;
              font-style: normal;
              line-height: 13px;
              letter-spacing: -0.5px;
            }
          }
        }
      }
    }
  }
}
</style>
