import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useTravelStore } from './store/travelStore'
import type { MapConfig } from './types'

interface AppOptions {
  mapConfig?: Partial<MapConfig>
}

export function mountApp(selector: string = '#app', options: AppOptions = {}) {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  if (options.mapConfig) {
    const store = useTravelStore()
    store.setMapConfig(options.mapConfig)
  } else {
    const store = useTravelStore()
    store.loadFromStorage()
  }

  app.mount(selector)
  return app
}

mountApp()
