<template>
  <div>
    <span v-if="isCompleted">Completed</span>
    <ul class="vuejs-countdown" v-else>
      <li v-if="days > 0" style="width: 42px">
        <p class="digit">{{ days | twoDigits }}</p>
        <p class="text">{{ days > 1 ? 'days' : 'day' }}</p>
      </li>
      <li v-if="days > 0">
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ hours | twoDigits }}</p>
        <p class="text">{{ hours > 1 ? 'hours' : 'hour' }}</p>
      </li>
      <li>
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ minutes | twoDigits }}</p>
        <p class="text">min</p>
      </li>
      <li>
        <p class="digit">:</p>
        <p class="text">&nbsp;</p>
      </li>
      <li style="width: 42px">
        <p class="digit">{{ seconds | twoDigits }}</p>
        <p class="text">Sec</p>
      </li>
    </ul>
  </div>
</template>

<script>
let interval = null;

export default {
  name: 'Countdown',
  props: {
    deadline: {
      type: Date
    },
    end: {
      type: Date
    },
    stop: {
      type: Boolean
    }
  },
  data() {
    return {
      now: Math.trunc((new Date()).getTime() / 1000),
      date: null,
      diff: 0
    }
  },
  created() {
    if (!this.deadline && !this.end) {
      throw new Error("Missing props 'deadline' or 'end'");
    }
    if (this.endTime.getTime() === 0) {
      return
    }
    this.date = Math.trunc(this.endTime.getTime() / 1000);
    if (!this.date) {
      throw new Error("Invalid props value, correct the 'deadline' or 'end'");
    }

    interval = setInterval(() => {
      this.now = Math.trunc((new Date()).getTime() / 1000);
    }, 1000);
  },
  computed: {
    isCompleted() {
      return (new Date()).getTime() - this.endTime > 0
    },
    endTime() {
      return this.deadline ? this.deadline : this.end;
    },

    seconds() {
      return Math.trunc(this.diff) % 60
    },

    minutes() {
      return Math.trunc(this.diff / 60) % 60
    },

    hours() {
      return Math.trunc(this.diff / 60 / 60) % 24
    },

    days() {
      return Math.trunc(this.diff / 60 / 60 / 24)
    }
  },
  watch: {
    now(value) {
      this.diff = this.date - this.now;
      if(this.diff <= 0 || this.stop){
        this.diff = 0;
        // Remove interval
        clearInterval(interval);
      }
    }
  },
  filters: {
    twoDigits(value) {
      if ( value.toString().length <= 1 ) {
        return '0'+value.toString()
      }
      return value.toString()
    }
  },
  destroyed() {
    clearInterval(interval);
  }
}
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