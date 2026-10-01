<template>
  <div class="detail-page">
    <header class="detail-header">
      <button class="back-btn ripple-btn" v-ripple @click="$router.back()">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="#333">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
      </button>
      <h1 class="detail-title" v-if="house">{{ house.title }}</h1>
      <button
        class="fav-btn ripple-btn" v-ripple
        :class="{ active: isFav }"
        @click="onToggleFav"
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
    </header>

    <div v-if="house" class="detail-body">
      <div class="carousel-wrap" ref="carouselWrapRef">
        <div
          class="carousel-track"
          :style="{ transform: `translateX(-${currentIndex * 100}%)` }"
        >
          <div
            v-for="(img, i) in house.images"
            :key="i"
            class="carousel-slide"
          >
            <img :src="img" :alt="`${house.title}-${i + 1}`" draggable="false" />
          </div>
        </div>
        <button
          class="nav-btn nav-prev ripple-btn" v-ripple
          @click="prevSlide"
          v-show="currentIndex > 0"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <button
          class="nav-btn nav-next ripple-btn" v-ripple
          @click="nextSlide"
          v-show="currentIndex < house.images.length - 1"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
          </svg>
        </button>
        <div class="dots">
          <span
            v-for="(_, i) in house.images"
            :key="i"
            class="dot"
            :class="{ active: i === currentIndex }"
            @click="currentIndex = i"
          ></span>
        </div>
        <div class="thumbs">
          <div
            v-for="(img, i) in house.images"
            :key="i"
            class="thumb"
            :class="{ active: i === currentIndex }"
            @click="currentIndex = i"
          >
            <img :src="img" />
          </div>
        </div>
      </div>

      <div class="info-card glass-card">
        <div class="price-row">
          <span class="price">
            <strong>¥{{ house.price }}</strong>
            <small>/月</small>
          </span>
          <div class="tags">
            <span v-if="house.isFirstRent" class="tag tag-orange">首次出租</span>
            <span class="tag tag-blue">{{ house.petPolicy }}</span>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">户型</span>
            <span class="value">{{ house.layout }}</span>
          </div>
          <div class="info-item">
            <span class="label">面积</span>
            <span class="value">{{ house.area }}㎡</span>
          </div>
          <div class="info-item">
            <span class="label">朝向</span>
            <span class="value">{{ house.orientation }}</span>
          </div>
          <div class="info-item">
            <span class="label">位置</span>
            <span class="value">{{ house.location }}</span>
          </div>
        </div>
        <div class="desc">
          <h3>房源描述</h3>
          <p>{{ house.description }}</p>
        </div>
      </div>

      <div class="landlord-card glass-card">
        <img :src="house.landlord.avatar" class="avatar" />
        <div class="landlord-info">
          <h3>{{ house.landlord.name }}</h3>
          <p>房东 · 已认证</p>
        </div>
        <button class="chat-btn ripple-btn" v-ripple @click="openChat(house.id)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
          </svg>
          联系房东
        </button>
      </div>

      <div class="appoint-card glass-card">
        <h3>预约看房</h3>
        <Transition name="collapse" mode="out-in">
          <form
            v-if="!appointed"
            key="form"
            class="appoint-form"
            @submit.prevent="onSubmit"
          >
            <div class="form-row">
              <div class="form-item">
                <label>选择日期</label>
                <input
                  type="date"
                  v-model="form.date"
                  required
                  :min="todayStr"
                />
              </div>
              <div class="form-item">
                <label>选择时间</label>
                <select v-model="form.time" required>
                  <option value="">请选择</option>
                  <option v-for="t in timeSlots" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>
            </div>
            <div class="form-item">
              <label>留言（可选）</label>
              <textarea
                v-model="form.message"
                rows="3"
                placeholder="请输入您想对房东说的话..."
              ></textarea>
            </div>
            <button type="submit" class="submit-btn ripple-btn" v-ripple>
              提交预约
            </button>
          </form>
          <div v-else key="success" class="appoint-success">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="#66bb6a">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <p>预约信息已提交</p>
            <small>{{ form.date }} {{ form.time }}</small>
          </div>
        </Transition>
      </div>
    </div>

    <div v-else class="loading">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRoute } from 'vue-router'
import { useHouseStore } from '@/stores/house'
import type { House } from '@/types'

const route = useRoute()
const store = useHouseStore()
const openChat = inject<(id: number) => void>('openChat')!
const showToast = inject<(msg: string) => void>('showToast')!

const houseId = computed(() => Number(route.params.id))
const house = computed<House | undefined>(() => store.getHouseById(houseId.value))
const isFav = computed(() => house.value ? store.isFavorite(house.value.id) : false)

const currentIndex = ref(0)
const carouselWrapRef = ref<HTMLElement | null>(null)
let startX = 0
let deltaX = 0
const isDragging = ref(false)

function prevSlide() {
  if (house.value && currentIndex.value > 0) {
    currentIndex.value--
  }
}
function nextSlide() {
  if (house.value && currentIndex.value < house.value.images.length - 1) {
    currentIndex.value++
  }
}

function onTouchStart(e: TouchEvent | MouseEvent) {
  isDragging.value = true
  startX = 'touches' in e ? e.touches[0].clientX : e.clientX
  deltaX = 0
}
function onTouchMove(e: TouchEvent | MouseEvent) {
  if (!isDragging.value) return
  const x = 'touches' in e ? e.touches[0].clientX : e.clientX
  deltaX = x - startX
}
function onTouchEnd() {
  if (!isDragging.value) return
  isDragging.value = false
  if (deltaX > 50) prevSlide()
  else if (deltaX < -50) nextSlide()
  deltaX = 0
}

watch(houseId, () => {
  currentIndex.value = 0
  appointed.value = false
})

onMounted(() => {
  if (carouselWrapRef.value) {
    const el = carouselWrapRef.value
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('mousedown', onTouchStart)
    el.addEventListener('mousemove', onTouchMove)
    window.addEventListener('mouseup', onTouchEnd)
  }
})

const today = new Date()
const todayStr = today.toISOString().split('T')[0]
const timeSlots = [
  '09:00 - 10:00',
  '10:00 - 11:00',
  '11:00 - 12:00',
  '13:00 - 14:00',
  '14:00 - 15:00',
  '15:00 - 16:00',
  '16:00 - 17:00',
  '17:00 - 18:00',
  '18:00 - 19:00',
  '19:00 - 20:00'
]

const form = ref({
  date: '',
  time: '',
  message: ''
})
const appointed = ref(false)

function onToggleFav() {
  if (house.value) {
    store.toggleFavorite(house.value.id)
  }
}

function onSubmit() {
  if (!form.value.date || !form.value.time) return
  if (!house.value) return
  store.submitAppointment({
    houseId: house.value.id,
    date: form.value.date,
    time: form.value.time,
    message: form.value.message
  })
  appointed.value = true
  showToast('预约成功，等待房东确认')
}
</script>

<style scoped>
.detail-page {
  min-height: 100vh;
  background: #faf3e0;
  padding-bottom: 30px;
}
.detail-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid #f0e6d0;
}
.back-btn, .fav-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: #fff3e0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.back-btn:hover, .fav-btn:hover {
  background: #ffe0b2;
}
.fav-btn.active {
  background: #ffebee;
}
.detail-title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-body {
  padding: 16px;
  max-width: 900px;
  margin: 0 auto;
}
.carousel-wrap {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 0 8px #ffab91;
  margin-bottom: 18px;
  background: #fff;
  user-select: none;
}
.carousel-track {
  display: flex;
  transition: transform 0.5s ease;
}
.carousel-slide {
  flex: 0 0 100%;
  width: 100%;
  aspect-ratio: 16/10;
  background: #f0e6d0;
}
.carousel-slide img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.nav-prev { left: 12px; }
.nav-next { right: 12px; }
.dots {
  position: absolute;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.25s;
}
.dot.active {
  background: #fff;
  width: 22px;
  border-radius: 4px;
}
.thumbs {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 6px;
  padding: 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.35));
  overflow-x: auto;
}
.thumb {
  flex: 0 0 56px;
  height: 44px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.thumb.active {
  border-color: #ff8a65;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.glass-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  margin-bottom: 18px;
}
.price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 10px;
}
.price strong {
  font-size: 28px;
  color: #ff7043;
  font-weight: 700;
}
.price small {
  font-size: 14px;
  color: #999;
}
.tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tag {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
}
.tag-orange {
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
}
.tag-blue {
  background: #e3f2fd;
  color: #1976d2;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid #f0e6d0;
  border-bottom: 1px solid #f0e6d0;
}
.info-item {
  display: flex;
  gap: 8px;
  font-size: 14px;
}
.info-item .label {
  color: #888;
  flex-shrink: 0;
}
.info-item .value {
  color: #333;
  font-weight: 500;
}
.desc h3 {
  font-size: 15px;
  margin: 14px 0 8px 0;
  color: #333;
}
.desc p {
  margin: 0;
  font-size: 14px;
  color: #555;
  line-height: 1.7;
}
.landlord-card {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #ffccbc;
}
.landlord-info {
  flex: 1;
}
.landlord-info h3 {
  margin: 0 0 2px 0;
  font-size: 16px;
  color: #333;
}
.landlord-info p {
  margin: 0;
  font-size: 12px;
  color: #888;
}
.chat-btn {
  padding: 10px 16px;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border: none;
  border-radius: 22px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.chat-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 112, 67, 0.35);
}
.appoint-card h3 {
  margin: 0 0 14px 0;
  font-size: 16px;
  color: #333;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.form-item {
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-item label {
  font-size: 13px;
  color: #555;
  font-weight: 500;
}
.form-item input,
.form-item select,
.form-item textarea {
  padding: 10px 12px;
  border: 1.5px solid #ccc;
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.3s;
  background: #fff;
  font-family: inherit;
  resize: vertical;
}
.form-item input:focus,
.form-item select:focus,
.form-item textarea:focus {
  border-color: #ff8a65;
}
.submit-btn {
  width: 100%;
  padding: 13px;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255, 112, 67, 0.4);
}
.appoint-success {
  text-align: center;
  padding: 16px 0 8px;
}
.appoint-success p {
  margin: 8px 0 4px;
  font-size: 15px;
  color: #333;
  font-weight: 500;
}
.appoint-success small {
  font-size: 13px;
  color: #888;
}
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}
.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 600px;
}
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 14px;
  color: #888;
}
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #ffccbc;
  border-top-color: #ff7043;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.ripple-btn {
  position: relative;
  overflow: hidden;
}
@media (max-width: 768px) {
  .form-row {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .info-grid {
    gap: 10px;
  }
}
</style>
