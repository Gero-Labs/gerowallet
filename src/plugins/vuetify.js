import Vue from 'vue';
import Vuetify from 'vuetify/lib/framework';
import i18n from "@/plugins/i18n";

Vue.use(Vuetify);

export default new Vuetify({
    lang: {
        t: (key, ...params) => i18n.t(key, params),
    },
    icons: {
        iconfont: "mdi"
    },
    theme: {
        dark: true,
        themes: {
            dark: {
                primary: '#2f9cac',
                secondary: '#b0bec5',
                accent: '#8c9eff',
                error: '#ff6464',
            },
        },
    },
});
