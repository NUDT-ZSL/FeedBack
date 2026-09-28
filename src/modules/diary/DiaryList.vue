<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useDiaryStore } from '@/modules/diary/diaryStore'
import { EMOTION_LABELS, EMOTION_COLORS, type DiaryEntry } from '@/types'

const store = useDiaryStore()

const scrollerRef = ref<HTMLDivElement | null>(null)
const containerHeight = ref(600)

const VISIBLE_COUNT = 30
const ITEM_ESTIMATED_HEIGHT = 200

const scrollTop = ref(0)

const displayStart = computed(() => {
  const start = Math.floor(scrollTop.value / ITEM_ESTIMATED_HEIGHT) - 5
  return Math.max(0, start)
})

const displayEnd = computed(() => {
  return Math.min(
    displayStart.value + VISIBLE_COUNT,
    store.filteredEntries.length
  )
})

const visibleEntries = computed(() => {
  return store.filteredEntries.slice(displayStart.value, displayEnd.value)
})

const totalHeight = computed(() => {
  return store.filteredEntries.length * ITEM_ESTIMATED_HEIGHT
})

const offsetY = computed(() => {
  return displayStart.value * ITEM_ESTIMATED_HEIGHT
})

const handleScroll = (e: Event) => {
  const target = e.target as HTMLDivElement
  scrollTop.value = target.scrollTop
}

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hour = date.getHours().toString().padStart(2, '0')
  const minute = date.getMinutes().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

const formatDateShort = (timestamp: number) => {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  if (sameDay) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  if (isYesterday) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const getTagColor = (tagName: string) => store.getTagColor(tagName)

const handleTagClick = (tagName: string) => {
  store.setSelectedTag(store.selectedTag === tagName ? null : tagName)
  if (scrollerRef.value) {
    scrollerRef.value.scrollTop = 0
  }
}

const deleteEntry = (id: string) => {
  if (confirm('确定要删除这篇日记吗？')) {
    store.deleteEntry(id)
  }
}

const getPlainText = (html: string) => {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || tmp.innerText || '').slice(0, 150)
}

watch(() => store.filteredEntries.length, async () => {
  await nextTick()
  if (scrollerRef.value) {
    scrollTop.value = scrollerRef.value.scrollTop
  }
})

onMounted(async () => {
  await nextTick()
  if (scrollerRef.value) {
    containerHeight.value = scrollerRef.value.clientHeight
  }
})
</script>

<template>
  <div class="list-wrapper fade-in">
    <div class="list-header">
      <div class="list-title-row">
        <h2 class="list-title">📚 我的日记</h2>
        <span class="list-count">共 {{ store.filteredEntries.length }} 篇</span>
      </div>

      <div class="filter-row">
        <div class="filter-tags">
          <span
            class="filter-tag"
            :class="{ active: !store.selectedTag }"
            @click="store.setSelectedTag(null)"
          >
            全部
          </span>
          <span
            v-for="tag in store.tags"
            :key="tag.name"
            class="filter-tag"
            :class="{ active: store.selectedTag === tag.name }"
            :style="{
              backgroundColor: store.selectedTag === tag.name ? tag.color : 'transparent',
              borderColor: tag.color,
              color: store.selectedTag === tag.name ? '#fff' : tag.color
            }"
            @click="handleTagClick(tag.name)"
          >
            {{ tag.name }}
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="store.filteredEntries.length === 0"
      class="empty-state"
    >
      <div class="empty-icon">📝</div>
      <p class="empty-text">
        {{ store.selectedTag ? '该标签下暂无日记' : '还没有日记，去写第一篇吧～' }}
      </p>
    </div>

    <div
      v-else
      ref="scrollerRef"
      class="diary-scroller"
      @scroll="handleScroll"
    >
      <div
        class="diary-spacer"
        :style="{ height: totalHeight + 'px', position: 'relative' }"
      >
        <div
          class="diary-offset"
          :style="{ transform: `translateY(${offsetY}px)` }"
        >
          <div
            v-for="entry in visibleEntries"
            :key="entry.id"
            class="diary-card card"
            :style="{ height: ITEM_ESTIMATED_HEIGHT + 'px' }"
          >
            <div class="card-header">
              <span class="card-date">{{ formatDateShort(entry.createdAt) }}</span>
              <span
                class="emotion-badge"
                :style="{
                  backgroundColor: EMOTION_COLORS[entry.emotion] + '22',
                  color: EMOTION_COLORS[entry.emotion]
                }"
              >
                <span
                  class="emotion-dot"
                  :style="{ backgroundColor: EMOTION_COLORS[entry.emotion] }"
                ></span>
                {{ EMOTION_LABELS[entry.emotion] }}
              </span>
            </div>

            <div
              class="card-content"
              v-html="entry.content"
            ></div>

            <div class="card-footer">
              <div class="card-tags">
                <span
                  v-for="tag in entry.tags"
                  :key="tag"
                  class="tag"
                  :style="{ backgroundColor: getTagColor(tag) }"
                  @click.stop="handleTagClick(tag)"
                >
                  #{{ tag }}
                </span>
              </div>
              <button
                type="button"
                class="btn-danger"
                @click.stop="deleteEntry(entry.id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-header {
  margin-bottom: 20px;
}

.list-title-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}

.list-title {
  font-size: 20px;
  color: #222;
}

.list-count {
  font-size: 13px;
  color: #888;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-tag {
  padding: 6px 14px;
  border-radius: 18px;
  font-size: 13px;
  cursor: pointer;
  border: 1.5px solid transparent;
  background: rgba(255, 255, 255, 0.5);
  color: #666;
  transition: all 0.2s ease;
}

.filter-tag:hover {
  transform: translateY(-1px);
}

.filter-tag.active {
  font-weight: 500;
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 16px;
}

.empty-icon {
  font-size: 56px;
  margin-bottom: 16px;
}

.empty-text {
  font-size: 15px;
  color: #fff;
  opacity: 0.9;
}

.diary-scroller {
  flex: 1;
  overflow-y: auto;
  max-height: 700px;
  min-height: 400px;
  padding-right: 4px;
}

.diary-spacer {
  width: 100%;
}

.diary-offset {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  will-change: transform;
}

.diary-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: auto !important;
  min-height: 160px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-date {
  font-size: 13px;
  color: #888;
}

.emotion-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.card-content {
  flex: 1;
  font-size: 14px;
  line-height: 1.75;
  color: #444;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  max-height: 110px;
}

.card-content :deep(p) {
  margin: 0;
}

.card-content :deep(ul),
.card-content :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}

.card-content :deep(b),
.card-content :deep(strong) {
  font-weight: 600;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #f0f0f0;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .list-title {
    font-size: 18px;
  }

  .filter-tag {
    padding: 5px 12px;
    font-size: 12px;
  }

  .diary-scroller {
    max-height: 500px;
  }

  .card-footer {
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }

  .card-tags {
    width: 100%;
  }
}
</style>
