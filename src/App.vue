<template>
  <div class="app">
    <router-view v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </router-view>

    <FavoritesSidebar
      :visible="showFavSidebar"
      @close="showFavSidebar = false"
      @open-chat="onOpenChatFromFav"
    />

    <ChatModal
      :visible="showChat"
      :house-id="chatHouseId"
      :landlord="chatLandlord"
      @close="showChat = false"
    />

    <Transition name="toast">
      <div v-if="toastMsg" class="toast-bar">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#4caf50">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
        {{ toastMsg }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, provide } from 'vue'
import FavoritesSidebar from '@/components/FavoritesSidebar.vue'
import ChatModal from '@/components/ChatModal.vue'
import { useHouseStore } from '@/stores/house'
import type { House } from '@/types'

const store = useHouseStore()
store.fetchHouses()

const showFavSidebar = ref(false)
const showChat = ref(false)
const chatHouseId = ref(0)
const chatLandlord = ref<House['landlord'] | null>(null)
const toastMsg = ref('')
let toastTimer: number | null = null

function showToast(msg: string) {
  toastMsg.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMsg.value = ''
  }, 3000)
}

function openFavSidebar() {
  showFavSidebar.value = true
}

function openChat(houseId: number) {
  const house = store.getHouseById(houseId)
  if (house) {
    chatHouseId.value = houseId
    chatLandlord.value = house.landlord
    showChat.value = true
  }
}

function onOpenChatFromFav(house: House) {
  chatHouseId.value = house.id
  chatLandlord.value = house.landlord
  showFavSidebar.value = false
  showChat.value = true
}

provide('openFavSidebar', openFavSidebar)
provide('openChat', openChat)
provide('showToast', showToast)
</script>

<style>
* {
  box-sizing: border-box;
}
html, body, #app {
  margin: 0;
  padding: 0;
  min-height: 100%;
  height: 100%;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: #faf3e0;
  color: #333;
  -webkit-font-smoothing: antialiased;
}
.app {
  min-height: 100vh;
  background: #faf3e0;
}
.page-enter-active,
.page-leave-active {
  transition: all 0.3s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.page-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
.toast-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  background: #fff;
  padding: 12px 20px;
  border-radius: 30px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
.ripple-btn {
  position: relative;
  overflow: hidden;
}
.ripple {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  transform: scale(0);
  animation: ripple 0.6s ease-out;
  pointer-events: none;
}
@keyframes ripple {
  to {
    transform: scale(4);
    opacity: 0;
  }
}
</style>
