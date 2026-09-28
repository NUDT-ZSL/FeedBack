import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'diary',
    component: () => import('@/views/DiaryPage.vue'),
    meta: { title: '写日记' }
  },
  {
    path: '/analysis',
    name: 'analysis',
    component: () => import('@/views/AnalysisPage.vue'),
    meta: { title: '情绪分析' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsPage.vue'),
    meta: { title: '提醒设置' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.afterEach((to) => {
  if (to.meta?.title) {
    document.title = `MindJournal - ${to.meta.title}`
  }
})

export default router
