import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './Sidepanel.vue'
import { setupApp } from '~/logic/common-setup'
import 'vuetify/styles'

const vuetify = createVuetify({ components, directives })

const app = createApp(App).use(vuetify)
setupApp(app)
app.mount('#app')
