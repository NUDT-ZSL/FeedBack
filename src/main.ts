import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { vRipple } from './directives/ripple'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.directive('ripple', vRipple)

app.mount('#app')
