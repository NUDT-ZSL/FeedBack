<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAllocationStore } from '@/stores/allocation'
import type { PlayerClass, AllocationRecord } from '@/modules/shared/types'
import {
  PLAYER_CLASS_NAMES,
  PLAYER_CLASS_COLORS,
  PLAYER_CLASS_ICONS,
  ITEM_QUALITY_COLORS,
  ITEM_QUALITY_NAMES
} from '@/modules/shared/types'

const store = useAllocationStore()

const filterClass = ref<PlayerClass | ''>('')
const startDate = ref('')
const endDate = ref('')

const playerClasses = Object.keys(PLAYER_CLASS_NAMES) as PlayerClass[]

const filteredRecords = computed(() => {
  let records = store.allocationHistory

  if (filterClass.value) {
    records = records.filter(r => r.winner.playerClass === filterClass.value)
  }

  if (startDate.value) {
    const start = new Date(startDate.value).getTime()
    records = records.filter(r => r.timestamp >= start)
  }

  if (endDate.value) {
    const end = new Date(endDate.value).getTime() + 86400000
    records = records.filter(r => r.timestamp < end)
  }

  return records
})

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

function exportCSV() {
  const csv = store.exportHistoryCSV()
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `分配记录_${new Date().toLocaleDateString('zh-CN')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function clearFilters() {
  filterClass.value = ''
  startDate.value = ''
  endDate.value = ''
}
</script>

<template>
  <div class="history-overlay" @click="store.toggleHistoryPanel()">
    <div class="history-panel" @click.stop>
      <div class="history-header">
        <h2>
          <i class="fa-solid fa-clock-rotate-left"></i>
          分配历史记录
        </h2>
        <button class="btn-close-panel" @click="store.toggleHistoryPanel()">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="history-filters">
        <div class="filter-group">
          <label><i class="fa-solid fa-user-group"></i> 职业筛选</label>
          <select v-model="filterClass" class="filter-select">
            <option value="">全部职业</option>
            <option v-for="cls in playerClasses" :key="cls" :value="cls">
              {{ PLAYER_CLASS_NAMES[cls] }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label><i class="fa-solid fa-calendar-days"></i> 开始日期</label>
          <input v-model="startDate" type="date" class="filter-input" />
        </div>
        <div class="filter-group">
          <label><i class="fa-solid fa-calendar-check"></i> 结束日期</label>
          <input v-model="endDate" type="date" class="filter-input" />
        </div>
        <div class="filter-actions">
          <button class="btn-filter-clear" @click="clearFilters">
            <i class="fa-solid fa-rotate-left"></i> 重置
          </button>
          <button class="btn-export" @click="exportCSV">
            <i class="fa-solid fa-download"></i> 导出CSV
          </button>
        </div>
      </div>

      <div class="record-count">
        共 <span>{{ filteredRecords.length }}</span> 条记录
      </div>

      <div class="timeline-container">
        <div v-if="filteredRecords.length === 0" class="empty-history">
          <i class="fa-solid fa-box-archive"></i>
          <p>暂无分配记录</p>
        </div>
        <div v-else class="timeline">
          <div
            v-for="(record, index) in filteredRecords"
            :key="record.id"
            class="timeline-item"
            :style="{ animationDelay: `${index * 0.03}s` }"
          >
            <div
              class="timeline-dot"
              :style="{ backgroundColor: PLAYER_CLASS_COLORS[record.winner.playerClass] }"
            >
              <i :class="['fa-solid', PLAYER_CLASS_ICONS[record.winner.playerClass]]"></i>
            </div>
            <div class="timeline-line"></div>
            <div class="timeline-content">
              <div class="timeline-date">
                <i class="fa-regular fa-clock"></i>
                {{ formatDate(record.timestamp) }}
              </div>
              <div class="timeline-card">
                <div class="timeline-boss">
                  <i class="fa-solid fa-crown"></i>
                  {{ record.bossName }}
                </div>
                <div class="timeline-item-info">
                  <div
                    class="item-quality-indicator"
                    :style="{ backgroundColor: ITEM_QUALITY_COLORS[record.item.quality] }"
                  ></div>
                  <div>
                    <div
                      class="item-name"
                      :style="{ color: ITEM_QUALITY_COLORS[record.item.quality] }"
                    >
                      {{ record.item.name }}
                    </div>
                    <div class="item-quality">
                      {{ ITEM_QUALITY_NAMES[record.item.quality] }}
                    </div>
                  </div>
                </div>
                <div class="timeline-winner">
                  <div
                    class="winner-class-badge"
                    :style="{ backgroundColor: PLAYER_CLASS_COLORS[record.winner.playerClass] + '20' }"
                  >
                    <i
                      :class="['fa-solid', PLAYER_CLASS_ICONS[record.winner.playerClass]]"
                      :style="{ color: PLAYER_CLASS_COLORS[record.winner.playerClass] }"
                    ></i>
                  </div>
                  <div>
                    <div
                      class="winner-name"
                      :style="{ color: PLAYER_CLASS_COLORS[record.winner.playerClass] }"
                    >
                      {{ record.winner.name }}
                    </div>
                    <div class="winner-class">
                      {{ PLAYER_CLASS_NAMES[record.winner.playerClass] }}
                    </div>
                  </div>
                </div>
                <div class="timeline-details">
                  <span class="mode-badge" :class="record.mode">
                    <i :class="record.mode === 'bidding' ? 'fa-solid fa-gavel' : 'fa-solid fa-dice'"></i>
                    {{ record.mode === 'bidding' ? '竞价' : 'Roll点' }}
                  </span>
                  <span class="dkp-spent-badge">
                    -{{ record.mode === 'bidding' ? record.bidAmount : record.item.baseDkp }} DKP
                  </span>
                  <span v-if="record.mode === 'rolling'" class="roll-badge">
                    <i class="fa-solid fa-dice"></i> {{ record.rollAmount }}点
                  </span>
                  <span v-if="record.mode === 'bidding'" class="bid-badge">
                    <i class="fa-solid fa-coins"></i> {{ record.bidAmount }}出价
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: flex-end;
  z-index: 300;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.history-panel {
  width: 500px;
  max-width: 100%;
  background: #16213e;
  height: 100vh;
  display: flex;
  flex-direction: column;
  animation: slideIn 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
  overflow: hidden;
}

@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(233, 69, 96, 0.2);
}

.history-header h2 {
  font-family: 'Cinzel', serif;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.history-header h2 i {
  color: #e94560;
}

.btn-close-panel {
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-close-panel:hover {
  background: rgba(233, 69, 96, 0.2);
  border-color: #e94560;
  color: #e94560;
}

.history-filters {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-group {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-group label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-select,
.filter-input {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  transition: all 0.2s;
}

.filter-select:focus,
.filter-input:focus {
  outline: none;
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.filter-select option {
  background: #16213e;
  color: #fff;
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.btn-filter-clear,
.btn-export {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
}

.btn-filter-clear {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-filter-clear:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.btn-export {
  background: linear-gradient(135deg, #e94560, #ff6b6b);
  color: #fff;
}

.btn-export:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
}

.record-count {
  padding: 12px 24px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.record-count span {
  color: #e94560;
  font-weight: 700;
  font-family: 'Cinzel', serif;
}

.timeline-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.timeline-container::-webkit-scrollbar {
  width: 6px;
}

.timeline-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.timeline-container::-webkit-scrollbar-thumb {
  background: rgba(233, 69, 96, 0.5);
  border-radius: 3px;
}

.empty-history {
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-history i {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
  color: rgba(233, 69, 96, 0.3);
}

.timeline {
  position: relative;
}

.timeline-item {
  position: relative;
  padding-left: 40px;
  margin-bottom: 20px;
  animation: itemIn 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) both;
}

@keyframes itemIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.timeline-dot {
  position: absolute;
  left: 0;
  top: 24px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  z-index: 2;
  box-shadow: 0 0 0 4px #16213e;
}

.timeline-line {
  position: absolute;
  left: 15px;
  top: 56px;
  bottom: -20px;
  width: 2px;
  background: rgba(255, 255, 255, 0.1);
}

.timeline-item:last-child .timeline-line {
  display: none;
}

.timeline-content {
  position: relative;
}

.timeline-date {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.timeline-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 14px;
  transition: all 0.2s;
}

.timeline-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(233, 69, 96, 0.3);
  transform: translateX(4px);
}

.timeline-boss {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.timeline-boss i {
  color: #e94560;
}

.timeline-item-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.item-quality-indicator {
  width: 4px;
  height: 40px;
  border-radius: 2px;
  flex-shrink: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 2px;
}

.item-quality {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.timeline-winner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 10px;
}

.winner-class-badge {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.winner-class-badge i {
  font-size: 14px;
}

.winner-name {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 2px;
}

.winner-class {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.timeline-details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mode-badge,
.dkp-spent-badge,
.roll-badge,
.bid-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.mode-badge.bidding {
  background: rgba(233, 69, 96, 0.2);
  color: #e94560;
}

.mode-badge.rolling {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.dkp-spent-badge {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.roll-badge {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
}

.bid-badge {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
}

@media (max-width: 768px) {
  .history-panel {
    width: 100%;
  }

  .history-filters {
    padding: 12px 16px;
  }

  .filter-group {
    min-width: 100%;
  }

  .timeline-container {
    padding: 12px 16px 20px;
  }

  .history-header {
    padding: 16px 20px;
  }
}
</style>
