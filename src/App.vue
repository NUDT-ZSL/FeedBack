<script setup lang="ts">
import { ref } from 'vue'

const isTransitioning = ref(false)
</script>

<template>
  <div class="app-container">
    <transition
      :class="{ 'transitioning': isTransitioning }"
      mode="out-in"
    >
      <router-view @vnode-before-enter="isTransitioning = true" @after-enter="isTransitioning = false" />
    </transition>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.v-enter-active,
.v-leave-active {
  transition: all var(--transition-slow);
}

.v-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.v-leave-to {
  opacity: 0;
  transform: scale(1.05);
}

.transitioning {
  pointer-events: none;
}
</style>
