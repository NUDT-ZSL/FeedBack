<template>
  <div
    class="house-card"
    :class="{ 'card-favorite': isFav }"
    @click="goDetail"
  >
    <div class="card-thumb">
      <img :src="house.images[0]" :alt="house.title" loading="lazy" />
      <button
        class="fav-btn"
        :class="{ active: isFav }"
        @click.stop="$emit('toggle-favorite')"
      >
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            :fill="isFav ? '#ff5252' : 'none'"
            stroke="#ff5252"
            stroke-width="2"
            d="M12 21s-7-4.35-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.65-7 10-7 10z"
          />
        </svg>
      </button>
      <div v-if="house.isFirstRent" class="tag tag-first">首次出租</div>
    </div>
    <div class="card-body">
      <h3 class="card-title">{{ house.title }}</h3>
      <div class="card-info">
        <span>{{ house.layout }}</span>
        <span class="sep">|</span>
        <span>{{ house.area }}㎡</span>
        <span class="sep">|</span>
        <span>{{ house.orientation }}</span>
      </div>
      <div class="card-location">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="#888">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
        </svg>
        <span>{{ house.location }}</span>
      </div>
      <div class="card-footer">
        <span class="price">
          <strong>¥{{ house.price }}</strong>
          <small>/月</small>
        </span>
        <span class="pet-tag">{{ house.petPolicy }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { House } from '@/types'

const props = defineProps<{
  house: House
  isFav: boolean
}>()

defineEmits<{
  (e: 'toggle-favorite'): void
}>()

const router = useRouter()
const isFav = computed(() => props.isFav)

function goDetail() {
  router.push(`/house/${props.house.id}`)
}
</script>

<style scoped>
.house-card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}
.house-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  transform: translateY(-3px);
}
.card-thumb {
  position: relative;
  width: 100%;
  padding-top: 60%;
  overflow: hidden;
  background: #f0e6d0;
}
.card-thumb img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}
.house-card:hover .card-thumb img {
  transform: scale(1.05);
}
.fav-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s;
  z-index: 2;
  position: relative;
  overflow: hidden;
}
.fav-btn:hover {
  transform: scale(1.1);
}
.fav-btn.active {
  background: rgba(255, 236, 236, 0.95);
}
.tag {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  z-index: 2;
}
.card-body {
  padding: 14px 16px 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin: 0;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.card-info {
  font-size: 13px;
  color: #666;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-info .sep {
  color: #ccc;
}
.card-location {
  font-size: 13px;
  color: #888;
  display: flex;
  align-items: center;
  gap: 4px;
}
.card-footer {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.price strong {
  font-size: 22px;
  color: #ff7043;
  font-weight: 700;
}
.price small {
  font-size: 12px;
  color: #999;
  margin-left: 2px;
}
.pet-tag {
  font-size: 12px;
  color: #795548;
  background: #fff3e0;
  padding: 3px 8px;
  border-radius: 12px;
}
</style>
