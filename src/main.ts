import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import WhiteboardRoom from './views/WhiteboardRoom.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/room/default'
    },
    {
      path: '/room/:roomId',
      name: 'WhiteboardRoom',
      component: WhiteboardRoom
    }
  ]
})

const app = createApp(App)
app.use(router)
app.mount('#app')
