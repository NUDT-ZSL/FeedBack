import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'HouseList',
    component: () => import('@/views/HouseList.vue')
  },
  {
    path: '/house/:id',
    name: 'HouseDetail',
    component: () => import('@/views/HouseDetail.vue'),
    props: true
  },
  {
    path: '/favorites',
    name: 'Favorites',
    component: () => import('@/views/FavoritesView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
