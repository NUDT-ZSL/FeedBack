<template>
  <div class="filter-bar">
    <div class="filter-header" @click="expanded = !expanded">
      <span class="title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff8a65">
          <path d="M3 5h18v2H3zm3 6h12v2H6zm4 6h4v2h-4z" />
        </svg>
        筛选排序
      </span>
      <span class="expand-icon" :class="{ rotated: expanded }">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#666">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </span>
    </div>
    <Transition name="expand">
      <div v-show="expanded" class="filter-body">
        <div class="filter-row">
          <div class="filter-group">
            <label>价格 (元/月)</label>
            <div class="range-inputs">
              <input
                type="number"
                placeholder="最低"
                :value="priceMin"
                @input="$emit('change', { priceMin: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
              />
              <span>-</span>
              <input
                type="number"
                placeholder="最高"
                :value="priceMax"
                @input="$emit('change', { priceMax: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
              />
            </div>
          </div>
          <div class="filter-group">
            <label>面积 (㎡)</label>
            <div class="range-inputs">
              <input
                type="number"
                placeholder="最小"
                :value="areaMin"
                @input="$emit('change', { areaMin: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
              />
              <span>-</span>
              <input
                type="number"
                placeholder="最大"
                :value="areaMax"
                @input="$emit('change', { areaMax: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
              />
            </div>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <label>户型</label>
            <select
              :value="layout"
              @change="$emit('change', { layout: ($event.target as HTMLSelectElement).value || null })"
            >
              <option value="">全部</option>
              <option v-for="l in layouts" :key="l" :value="l">{{ l }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label>排序</label>
            <select
              :value="sortType"
              @change="$emit('sort', ($event.target as HTMLSelectElement).value as any)"
            >
              <option value="timeDesc">最新发布</option>
              <option value="priceAsc">价格升序</option>
              <option value="priceDesc">价格降序</option>
            </select>
          </div>
        </div>
        <div class="filter-actions">
          <button class="btn-reset ripple-btn" v-ripple @click="$emit('reset')">
            重置
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { FilterState, SortType } from '@/types'

defineProps<{
  priceMin: number | null
  priceMax: number | null
  areaMin: number | null
  areaMax: number | null
  layout: string | null
  sortType: SortType
}>()

defineEmits<{
  (e: 'change', filter: Partial<FilterState>): void
  (e: 'sort', type: SortType): void
  (e: 'reset'): void
}>()

const expanded = ref(true)
const layouts = ['一室一厅', '两室一厅', '两室两厅', '三室一厅', '三室两厅', '四室两厅']
</script>

<style scoped>
.filter-bar {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 16px;
  padding: 4px 16px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
}
.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  cursor: pointer;
  user-select: none;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #333;
  font-size: 15px;
}
.expand-icon {
  transition: transform 0.3s ease;
  display: flex;
}
.expand-icon.rotated {
  transform: rotate(180deg);
}
.filter-body {
  padding-bottom: 16px;
}
.filter-row {
  display: flex;
  gap: 20px;
  margin-bottom: 14px;
}
.filter-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.filter-group label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}
.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
}
.range-inputs span {
  color: #999;
}
input, select {
  flex: 1;
  padding: 8px 12px;
  border: 1.5px solid #ccc;
  border-radius: 10px;
  font-size: 14px;
  background: #fff;
  transition: border-color 0.3s ease;
  outline: none;
  min-width: 0;
}
input:focus, select:focus {
  border-color: #ff8a65;
}
.filter-actions {
  display: flex;
  justify-content: flex-end;
}
.btn-reset {
  padding: 8px 20px;
  border: 1.5px solid #ff8a65;
  color: #ff8a65;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.25s;
}
.btn-reset:hover {
  background: #fff3e0;
}
.ripple-btn {
  position: relative;
  overflow: hidden;
}
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 300px;
}
@media (max-width: 768px) {
  .filter-row {
    flex-direction: column;
    gap: 14px;
  }
}
</style>
