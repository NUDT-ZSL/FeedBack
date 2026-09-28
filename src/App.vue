<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDiaryStore } from '@/modules/diary/diaryStore'
import { startReminderService, getUnreadCount, markAllAsRead } from '@/modules/notification/ReminderService'

const router = useRouter()
const route = useRoute()
const store = useDiaryStore()

const unreadCount = ref(0)

const navItems = [
  { path: '/', name: '写日记', icon: '📝' },
  { path: '/analysis', name: '情绪分析', icon: '📊' },
  { path: '/settings', name: '提醒设置', icon: '⚙️' }
]

const currentPath = computed(() => route.path)

onMounted(() => {
  store.loadFromStorage()
  startReminderService()
  unreadCount.value = getUnreadCount()

  setInterval(() => {
    unreadCount.value = getUnreadCount()
  }, 5000)
})

const isActive = (path: string) => currentPath.value === path

const handleNavClick = (path: string) => {
  if (path === '/settings') {
    markAllAsRead()
    unreadCount.value = 0
  }
  router.push(path)
}
</script>

<template>
  <div class="app-container">
    <nav class="navbar">
      <div class="nav-brand" @click="router.push('/')">
        <span class="logo">💭</span>
        <span class="brand-name">MindJournal</span>
      </div>
      <div class="nav-menu">
        <div
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          @click="handleNavClick(item.path)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-text">{{ item.name }}</span>
          <span v-if="item.path === '/settings' && unreadCount > 0" class="notification-badge">
            {{ unreadCount > 99 ? '99+' : unreadCount }}
          </span>
        </div>
      </div>
    </nav>

    <main class="main-content fade-in">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  padding: 0 32px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.logo {
  font-size: 28px;
}

.brand-name {
  font-size: 20px;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav-menu {
  display: flex;
  gap: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  color: #666;
  font-weight: 500;
}

.nav-item:hover {
  background: rgba(102, 126, 234, 0.08);
  color: #667eea;
}

.nav-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.nav-icon {
  font-size: 18px;
}

.nav-text {
  font-size: 14px;
}

.notification-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #ff4757;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.main-content {
  flex: 1;
  padding: 32px;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .navbar {
    padding: 0 16px;
    height: auto;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
  }

  .nav-menu {
    width: 100%;
    justify-content: space-around;
  }

  .nav-item {
    padding: 8px 12px;
  }

  .nav-text {
    display: none;
  }

  .main-content {
    padding: 16px;
  }
}
</style>
