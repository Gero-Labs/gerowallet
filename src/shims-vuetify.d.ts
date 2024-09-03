import 'vuetify/types';

declare module 'vue/types/vue' {
  interface Vue {
    $vuetify: Vuetify;
  }
}
