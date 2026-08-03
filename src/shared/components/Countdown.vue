<template>
  <div>
    <span v-if="isCompleted">Completed</span>
    <ul class="vuejs-countdown" v-else>
      <li v-if="days > 0" style="width: 42px">
        <p class="digit">{{ twoDigits(days) }}</p>
        <p class="text">{{ days > 1 ? 'days' : 'day' }}</p>
      </li>
      <li v-if="days > 0">
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ twoDigits(hours) }}</p>
        <p class="text">{{ hours > 1 ? 'hours' : 'hour' }}</p>
      </li>
      <li>
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ twoDigits(minutes) }}</p>
        <p class="text">min</p>
      </li>
      <li>
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ twoDigits(seconds) }}</p>
        <p class="text">Sec</p>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';



const props = defineProps({
  deadline: {
    type: Date
  },
  end: {
    type: Date
  },
  stop: {
    type: Boolean
  }
});

const now = ref(Math.trunc((new Date()).getTime() / 1000));
const date = ref<number | null>(null);
const diff = ref(0);
let interval: NodeJS.Timeout | null = null;

const endTime = computed(() => {
  return props.deadline ? props.deadline : props.end;
});

const isCompleted = computed(() => {
  return (new Date()).getTime() - endTime.value! > 0
});

const seconds = computed(() => {
  return Math.trunc(diff.value) % 60
});

const minutes = computed(() => {
  return Math.trunc(diff.value / 60) % 60
});

const hours = computed(() => {
  return Math.trunc(diff.value / 60 / 60) % 24
});

const days = computed(() => {
  return Math.trunc(diff.value / 60 / 60 / 24)
});

const twoDigits = (value: number) => {
  if (value.toString().length <= 1) {
    return '0' + value.toString()
  }
  return value.toString()
};

watch(now, (_value) => {
  diff.value = date.value! - now.value;
  if (diff.value <= 0 || props.stop) {
    diff.value = 0;
    if (interval) {
      clearInterval(interval);
    }
  }
});

onMounted(() => {
  if (!props.deadline && !props.end) {
    throw new Error("Missing props 'deadline' or 'end'");
  }
  if (endTime.value!.getTime() === 0) {
    return
  }
  date.value = Math.trunc(endTime.value!.getTime() / 1000);
  if (!date.value) {
    throw new Error("Invalid props value, correct the 'deadline' or 'end'");
  }

  interval = setInterval(() => {
    now.value = Math.trunc((new Date()).getTime() / 1000);
  }, 1000);
});

onUnmounted(() => {
  if (interval) {
    clearInterval(interval);
  }
});
</script>
<style>
.vuejs-countdown {
  padding: 0;
  margin: 0;
}
.vuejs-countdown li {
  display: inline-block;
  text-align: center;
  position: relative;
}
.vuejs-countdown li p {
  margin: 0;
}
.vuejs-countdown li:first-of-type {
  margin-left: 0;
}
.vuejs-countdown li:last-of-type {
  margin-right: 0;
}
.vuejs-countdown li:last-of-type:after {
  content: "";
}
.vuejs-countdown .digit {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 0;
}
.vuejs-countdown .text {
  text-transform: uppercase;
  margin-bottom: 0;
  font-size: 10px;
}
</style>