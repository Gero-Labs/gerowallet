<template>
  <button large class="app-btn" :disabled="disabled" :class="[type, role]">
    <slot />
  </button>
</template>

<!------------------------------------------------------------------------------ Script -->

<script lang="ts">
export default {
  props: {
    type: {
      type: String, // 'filled' | 'framed',
      default: 'filled',
    },
    role: {
      type: String, // 'primary' | 'secondary' | 'success' | 'danger' | 'warning'
      default: 'primary',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
};
</script>

<!------------------------------------------------------------------------------ Style -->

<style>
.app-btn {
  height: 40px;
  cursor: pointer;
  font-size: 16px;
  min-width: 200px;
  font-weight: 600;
  line-height: 24px;
  font-family: Inter;
  border-radius: 10px;
  text-transform: capitalize;

  &:hover {
    filter: brightness(150%) !important;
  }
}

.app-btn.filled.primary {
  color: black;
  background-color: #00e3e2; /* fallback */
  background-image: linear-gradient(45deg, #00c7f3, #00ffd1);
}

.app-btn.framed {
  border-width: thin;
  border-style: solid;
  background: #141414;

  &:hover {
    border-color: white !important;
  }
}

.app-btn.framed.danger {
  border-color: #ff4747; /* fallback */
  /* TODO: gradient doesn't work */
  /* border-image-source: linear-gradient(90deg, #ff0000, #ff8e8e); */
}

.app-btn[disabled]:hover {
  filter: brightness(100%) !important;
}

.app-btn[disabled].filled {
  color: black; /* TODO: #4b4b4b looks better */
  background: #262626;
  border: 1px solid #4b4b4b;
  box-shadow: 0px 1px 2px 0px #1018280d;
}

/* TODO: Implement Variations Below */

.app-btn[disabled].framed {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
  color: black;
}

.app-btn.filled.secondary {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
  color: black;
}

.app-btn.filled.danger {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
  color: black;
}

.app-btn.framed.primary {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
  color: black;
}

.app-btn.framed.secondary {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
  color: black;
}
</style>
