<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Pie } from 'vue-chartjs'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip as ChartTooltip,
  Legend
} from 'chart.js'
import { useAllocationStore } from '@/stores/allocation'
import type { PlayerClass, Player, LootItem } from '@/modules/shared/types'
import {
  PLAYER_CLASS_NAMES,
  PLAYER_CLASS_COLORS,
  PLAYER_CLASS_ICONS,
  ITEM_QUALITY_COLORS,
  ITEM_QUALITY_NAMES,
  ITEM_SLOT_NAMES
} from '@/modules/shared/types'
import HistoryPanel from './HistoryPanel.vue'

ChartJS.register(ArcElement, ChartTooltip, Legend)

const store = useAllocationStore()

const newPlayerName = ref('')
const newPlayerClass = ref<PlayerClass>('warrior')
const newPlayerDkp = ref(100)
const sidebarOpen = ref(false)
const editingPlayer = ref<Player | null>(null)
const editName = ref('')
const editClass = ref<PlayerClass>('warrior')
const editDkp = ref(0)
const showTooltip = ref<string | null>(null)
const tooltipPosition = ref({ x: 0, y: 0 })

const playerClasses = Object.keys(PLAYER_CLASS_NAMES) as PlayerClass[]

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 300
  },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        color: '#ffffff',
        font: {
          family: "'Noto Sans SC', sans-serif",
          size: 11
        },
        padding: 10
      }
    },
    tooltip: {
      backgroundColor: 'rgba(22, 33, 62, 0.95)',
      titleColor: '#e94560',
      bodyColor: '#ffffff',
      borderColor: '#e94560',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 8
    }
  }
}

function handleAddPlayer() {
  if (!newPlayerName.value.trim()) return
  store.addPlayer(newPlayerName.value.trim(), newPlayerClass.value, newPlayerDkp.value)
  newPlayerName.value = ''
  newPlayerDkp.value = 100
}

function startEditPlayer(player: Player) {
  editingPlayer.value = player
  editName.value = player.name
  editClass.value = player.playerClass
  editDkp.value = player.dkp
}

function saveEditPlayer() {
  if (!editingPlayer.value) return
  store.updatePlayer(editingPlayer.value.id, {
    name: editName.value.trim(),
    playerClass: editClass.value,
    dkp: editDkp.value
  })
  editingPlayer.value = null
}

function cancelEditPlayer() {
  editingPlayer.value = null
}

function handleRemovePlayer(id: string) {
  store.removePlayer(id)
}

function handleStartRaid() {
  store.startRaid()
}

function handleSelectItem(item: LootItem) {
  store.selectItem(item)
}

function handleBidChange(playerId: string, value: string) {
  const amount = parseInt(value) || 0
  store.setBid(playerId, amount)
}

function getBidAmount(playerId: string): number {
  const bid = store.bids.find(b => b.playerId === playerId)
  return bid ? bid.amount : 0
}

function handleAllocate() {
  if (store.allocationMode === 'bidding') {
    store.allocateBidding()
  } else {
    store.allocateRolling()
  }
}

function showItemTooltip(e: MouseEvent, itemId: string) {
  showTooltip.value = itemId
  tooltipPosition.value = { x: e.clientX, y: e.clientY }
}

function hideItemTooltip() {
  showTooltip.value = null
}

function getTooltipItem(): LootItem | undefined {
  if (!showTooltip.value) return undefined
  return store.currentLoot.find(i => i.id === showTooltip.value)
}

function canAllocate(): boolean {
  if (!store.selectedItem) return false
  if (store.allocationMode === 'bidding') {
    return store.bids.some(b => b.amount > 0)
  }
  return store.players.some(p => p.dkp >= store.selectedItem!.baseDkp)
}

onMounted(() => {
  const samplePlayers: Array<{ name: string; cls: PlayerClass; dkp: number }> = [
    { name: '战神阿瑞斯', cls: 'warrior', dkp: 150 },
    { name: '烈焰法师', cls: 'mage', dkp: 180 },
    { name: '圣光牧师', cls: 'priest', dkp: 120 },
    { name: '暗影刺客', cls: 'rogue', dkp: 140 },
    { name: '猎风者', cls: 'hunter', dkp: 130 },
    { name: '诅咒使者', cls: 'warlock', dkp: 160 },
    { name: '白银骑士', cls: 'paladin', dkp: 145 },
    { name: '雷霆萨满', cls: 'shaman', dkp: 135 }
  ]
  samplePlayers.forEach(p => store.addPlayer(p.name, p.cls, p.dkp))
})
</script>

<template>
  <div class="app-container">
    <header class="mobile-header" @click="sidebarOpen = !sidebarOpen">
      <i class="fa-solid fa-bars"></i>
      <span class="header-title">公会战利品分配</span>
      <i class="fa-solid fa-clock-rotate-left history-icon" @click.stop="store.toggleHistoryPanel()"></i>
    </header>

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-header">
        <h2><i class="fa-solid fa-users"></i> 团队管理</h2>
      </div>

      <div class="add-player-form">
        <h3><i class="fa-solid fa-user-plus"></i> 添加成员</h3>
        <input
          v-model="newPlayerName"
          type="text"
          placeholder="玩家名称"
          class="form-input"
          @keyup.enter="handleAddPlayer"
        />
        <select v-model="newPlayerClass" class="form-select">
          <option v-for="cls in playerClasses" :key="cls" :value="cls">
            {{ PLAYER_CLASS_NAMES[cls] }}
          </option>
        </select>
        <input
          v-model.number="newPlayerDkp"
          type="number"
          min="0"
          placeholder="初始DKP"
          class="form-input"
        />
        <button class="btn btn-primary" @click="handleAddPlayer">
          <i class="fa-solid fa-plus"></i> 添加
        </button>
      </div>

      <div class="player-list">
        <h3><i class="fa-solid fa-list"></i> 团队成员 ({{ store.players.length }})</h3>
        <div class="player-scroll">
          <div
            v-for="(player, index) in store.players"
            :key="player.id"
            class="player-card"
            :style="{ animationDelay: `${index * 0.05}s` }"
          >
            <template v-if="editingPlayer?.id === player.id">
              <input v-model="editName" type="text" class="edit-input" />
              <select v-model="editClass" class="edit-select">
                <option v-for="cls in playerClasses" :key="cls" :value="cls">
                  {{ PLAYER_CLASS_NAMES[cls] }}
                </option>
              </select>
              <input v-model.number="editDkp" type="number" min="0" class="edit-input" />
              <div class="edit-actions">
                <button class="btn-icon btn-save" @click="saveEditPlayer">
                  <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn-icon btn-cancel" @click="cancelEditPlayer">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="player-info">
                <div
                  class="class-icon"
                  :style="{ backgroundColor: PLAYER_CLASS_COLORS[player.playerClass] + '20' }"
                >
                  <i
                    :class="['fa-solid', PLAYER_CLASS_ICONS[player.playerClass]]"
                    :style="{ color: PLAYER_CLASS_COLORS[player.playerClass] }"
                  ></i>
                </div>
                <div class="player-details">
                  <div class="player-name">{{ player.name }}</div>
                  <div
                    class="player-class"
                    :style="{ color: PLAYER_CLASS_COLORS[player.playerClass] }"
                  >
                    {{ PLAYER_CLASS_NAMES[player.playerClass] }}
                  </div>
                </div>
              </div>
              <div class="player-dkp">
                <span class="dkp-value">{{ player.dkp }}</span>
                <span class="dkp-label">DKP</span>
              </div>
              <div class="player-actions">
                <button class="btn-icon btn-edit" @click="startEditPlayer(player)">
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-icon btn-delete" @click="handleRemovePlayer(player.id)">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <div class="main-header">
        <h1>
          <i class="fa-solid fa-swords"></i>
          公会战利品分配模拟器
        </h1>
        <button class="btn btn-raid" @click="handleStartRaid">
          <i class="fa-solid fa-skull"></i> 开始副本
        </button>
      </div>

      <div v-if="store.currentBoss" class="boss-info">
        <i class="fa-solid fa-crown"></i>
        当前Boss：<span>{{ store.currentBoss }}</span>
      </div>

      <section class="loot-section">
        <h2><i class="fa-solid fa-gem"></i> 掉落物品</h2>
        <div v-if="store.currentLoot.length === 0" class="empty-loot">
          <i class="fa-solid fa-box-open"></i>
          <p>点击"开始副本"模拟Boss击杀获取掉落</p>
        </div>
        <div v-else class="loot-grid">
          <div
            v-for="(item, index) in store.currentLoot"
            :key="item.id"
            class="loot-card"
            :class="{ selected: store.selectedItem?.id === item.id }"
            :style="{
              borderColor: ITEM_QUALITY_COLORS[item.quality],
              animationDelay: `${index * 0.1}s`
            }"
            @click="handleSelectItem(item)"
            @mouseenter="showItemTooltip($event, item.id)"
            @mouseleave="hideItemTooltip"
          >
            <div
              class="loot-quality-bar"
              :style="{ backgroundColor: ITEM_QUALITY_COLORS[item.quality] }"
            ></div>
            <div class="loot-icon">
              <i class="fa-solid fa-chest"></i>
            </div>
            <div
              class="loot-quality-badge"
              :style="{ backgroundColor: ITEM_QUALITY_COLORS[item.quality] }"
            >
              {{ ITEM_QUALITY_NAMES[item.quality] }}
            </div>
          </div>
        </div>
      </section>

      <div
        v-if="showTooltip"
        class="item-tooltip"
        :style="{ left: tooltipPosition.x + 15 + 'px', top: tooltipPosition.y + 15 + 'px' }"
      >
        <div
          class="tooltip-name"
          :style="{ color: ITEM_QUALITY_COLORS[getTooltipItem()?.quality || 'uncommon'] }"
        >
          {{ getTooltipItem()?.name }}
        </div>
        <div class="tooltip-slot">
          {{ ITEM_SLOT_NAMES[getTooltipItem()?.slot || 'head'] }}
        </div>
        <div class="tooltip-stats">
          <div v-for="(value, stat) in getTooltipItem()?.stats" :key="stat" class="stat-row">
            <span>{{ stat }}</span>
            <span class="stat-value">+{{ value }}</span>
          </div>
        </div>
        <div class="tooltip-dkp">
          基础DKP：<span>{{ getTooltipItem()?.baseDkp }}</span>
        </div>
      </div>

      <section class="allocation-section">
        <h2><i class="fa-solid fa-coins"></i> 分配控制</h2>

        <div class="selected-item-info" v-if="store.selectedItem">
          <div class="selected-item-header">
            <i
              class="fa-solid fa-chest selected-item-icon"
              :style="{ color: ITEM_QUALITY_COLORS[store.selectedItem.quality] }"
            ></i>
            <div>
              <div
                class="selected-item-name"
                :style="{ color: ITEM_QUALITY_COLORS[store.selectedItem.quality] }"
              >
                {{ store.selectedItem.name }}
              </div>
              <div class="selected-item-detail">
                {{ ITEM_QUALITY_NAMES[store.selectedItem.quality] }} ·
                {{ ITEM_SLOT_NAMES[store.selectedItem.slot] }} ·
                基础DKP: {{ store.selectedItem.baseDkp }}
              </div>
            </div>
          </div>
        </div>

        <div class="mode-switch">
          <button
            class="mode-btn"
            :class="{ active: store.allocationMode === 'rolling' }"
            @click="store.setAllocationMode('rolling')"
          >
            <i class="fa-solid fa-dice"></i> Roll点分配
          </button>
          <button
            class="mode-btn"
            :class="{ active: store.allocationMode === 'bidding' }"
            @click="store.setAllocationMode('bidding')"
          >
            <i class="fa-solid fa-gavel"></i> 竞价分配
          </button>
        </div>

        <div v-if="store.allocationMode === 'bidding' && store.selectedItem" class="bidding-panel">
          <h4><i class="fa-solid fa-hand-holding-dollar"></i> 玩家出价</h4>
          <div class="bidding-grid">
            <div
              v-for="player in store.players"
              :key="player.id"
              class="bid-input-row"
            >
              <div
                class="bid-player-class"
                :style="{ backgroundColor: PLAYER_CLASS_COLORS[player.playerClass] }"
              >
                <i :class="['fa-solid', PLAYER_CLASS_ICONS[player.playerClass]]"></i>
              </div>
              <span class="bid-player-name">{{ player.name }}</span>
              <span class="bid-player-dkp">({{ player.dkp }} DKP)</span>
              <input
                type="number"
                min="0"
                :max="player.dkp"
                :value="getBidAmount(player.id)"
                @input="handleBidChange(player.id, ($event.target as HTMLInputElement).value)"
                class="bid-input"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div v-if="store.allocationMode === 'rolling' && store.selectedItem" class="rolling-panel">
          <h4><i class="fa-solid fa-dice"></i> 符合条件玩家</h4>
          <p class="rolling-hint">
            系统将为所有DKP ≥ {{ store.selectedItem.baseDkp }} 的玩家自动掷点
          </p>
          <div class="eligible-list">
            <span
              v-for="player in store.players.filter(p => p.dkp >= store.selectedItem!.baseDkp)"
              :key="player.id"
              class="eligible-tag"
              :style="{ borderColor: PLAYER_CLASS_COLORS[player.playerClass] }"
            >
              <i
                :class="['fa-solid', PLAYER_CLASS_ICONS[player.playerClass]]"
                :style="{ color: PLAYER_CLASS_COLORS[player.playerClass] }"
              ></i>
              {{ player.name }}
            </span>
          </div>
        </div>

        <button
          class="btn btn-allocate"
          :disabled="!canAllocate()"
          @click="handleAllocate"
        >
          <i class="fa-solid fa-trophy"></i>
          {{ store.allocationMode === 'bidding' ? '确认竞价分配' : '开始Roll点' }}
        </button>
      </section>

      <section class="chart-section">
        <h2><i class="fa-solid fa-chart-pie"></i> 各职业DKP占比</h2>
        <div class="chart-container">
          <Pie
            v-if="store.players.length > 0"
            :data="store.chartData"
            :options="chartOptions"
          />
          <div v-else class="empty-chart">
            <i class="fa-solid fa-chart-pie"></i>
            <p>添加团队成员后显示DKP分布</p>
          </div>
        </div>
      </section>

      <button class="history-toggle" @click="store.toggleHistoryPanel()">
        <i class="fa-solid fa-clock-rotate-left"></i>
        查看历史记录
      </button>
    </main>

    <div v-if="store.showResultModal" class="modal-overlay" @click="store.closeResultModal">
      <div class="result-modal" @click.stop>
        <div class="modal-header">
          <i class="fa-solid fa-party-horn"></i>
          <h3>分配成功！</h3>
        </div>
        <div class="modal-content">
          <div
            class="result-item-icon"
            :style="{ borderColor: ITEM_QUALITY_COLORS[store.lastAllocationResult?.item?.quality || 'uncommon'] }"
          >
            <i
              class="fa-solid fa-chest"
              :style="{ color: ITEM_QUALITY_COLORS[store.lastAllocationResult?.item?.quality || 'uncommon'] }"
            ></i>
          </div>
          <div
            class="result-item-name"
            :style="{ color: ITEM_QUALITY_COLORS[store.lastAllocationResult?.item?.quality || 'uncommon'] }"
          >
            {{ store.lastAllocationResult?.item?.name }}
          </div>
          <div class="result-arrow">
            <i class="fa-solid fa-arrow-down"></i>
          </div>
          <div class="result-winner">
            <div
              class="winner-class-icon"
              :style="{ backgroundColor: PLAYER_CLASS_COLORS[store.lastAllocationResult?.winner?.playerClass || 'warrior'] + '20' }"
            >
              <i
                :class="['fa-solid', PLAYER_CLASS_ICONS[store.lastAllocationResult?.winner?.playerClass || 'warrior']]"
                :style="{ color: PLAYER_CLASS_COLORS[store.lastAllocationResult?.winner?.playerClass || 'warrior'] }"
              ></i>
            </div>
            <span
              class="winner-name"
              :style="{ color: PLAYER_CLASS_COLORS[store.lastAllocationResult?.winner?.playerClass || 'warrior'] }"
            >
              {{ store.lastAllocationResult?.winner?.name }}
            </span>
          </div>
          <div class="result-dkp">
            消耗DKP：<span class="dkp-spent">-{{ store.lastAllocationResult?.dkpSpent }}</span>
          </div>
          <div v-if="store.lastAllocationResult?.roll" class="result-roll">
            Roll点：<span class="roll-value">{{ store.lastAllocationResult.roll }}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-close" @click="store.closeResultModal">
          确认
        </button>
      </div>
    </div>

    <HistoryPanel v-if="store.showHistoryPanel" />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  min-height: 100vh;
  background: #1a1a2e;
  font-family: 'Noto Sans SC', sans-serif;
}

.mobile-header {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: #16213e;
  padding: 0 20px;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
  border-bottom: 1px solid rgba(233, 69, 96, 0.3);
}

.mobile-header i {
  color: #e94560;
  font-size: 20px;
  cursor: pointer;
}

.header-title {
  font-family: 'Cinzel', serif;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.history-icon {
  font-size: 18px !important;
}

.sidebar {
  width: 280px;
  background: #16213e;
  border-right: 1px solid rgba(233, 69, 96, 0.2);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 50;
  overflow-y: auto;
}

.sidebar-header {
  padding: 24px 20px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-header h2 {
  font-family: 'Cinzel', serif;
  font-size: 18px;
  font-weight: 700;
  color: #e94560;
  margin: 0;
}

.sidebar-header h2 i {
  margin-right: 8px;
}

.add-player-form {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.add-player-form h3,
.player-list h3 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  margin-bottom: 8px;
  box-sizing: border-box;
  transition: all 0.2s;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.form-select {
  cursor: pointer;
}

.form-select option {
  background: #16213e;
  color: #fff;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-primary {
  background: linear-gradient(135deg, #e94560, #ff6b6b);
  color: #fff;
  width: 100%;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.player-list {
  padding: 16px 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.player-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.player-scroll::-webkit-scrollbar {
  width: 4px;
}

.player-scroll::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}

.player-scroll::-webkit-scrollbar-thumb {
  background: rgba(233, 69, 96, 0.5);
  border-radius: 2px;
}

.player-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  animation: cardIn 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) both;
  transition: all 0.2s;
}

.player-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(233, 69, 96, 0.3);
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.player-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.class-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.class-icon i {
  font-size: 16px;
}

.player-details {
  min-width: 0;
}

.player-name {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-class {
  font-size: 11px;
  font-weight: 500;
}

.player-dkp {
  text-align: center;
  flex-shrink: 0;
}

.dkp-value {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #e94560;
  font-family: 'Cinzel', serif;
}

.dkp-label {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.player-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-icon {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  font-size: 12px;
}

.btn-edit {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.btn-edit:hover {
  background: rgba(59, 130, 246, 0.4);
}

.btn-delete {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.4);
}

.btn-save {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.btn-save:hover {
  background: rgba(34, 197, 94, 0.4);
}

.btn-cancel {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.btn-cancel:hover {
  background: rgba(156, 163, 175, 0.4);
}

.edit-input,
.edit-select {
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  flex: 1;
  min-width: 0;
}

.edit-actions {
  display: flex;
  gap: 4px;
}

.main-content {
  flex: 1;
  margin-left: 280px;
  padding: 32px 40px;
  overflow-y: auto;
}

.main-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.main-header h1 {
  font-family: 'Cinzel', serif;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  margin: 0;
}

.main-header h1 i {
  color: #e94560;
  margin-right: 12px;
}

.btn-raid {
  background: linear-gradient(135deg, #e94560, #ff6b6b);
  color: #fff;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
}

.btn-raid:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 6px 20px rgba(233, 69, 96, 0.5);
}

.boss-info {
  background: rgba(233, 69, 96, 0.1);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 8px;
  padding: 12px 20px;
  color: #fff;
  font-size: 14px;
  margin-bottom: 24px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.boss-info i {
  color: #e94560;
}

.boss-info span {
  color: #e94560;
  font-weight: 700;
  font-family: 'Cinzel', serif;
}

.loot-section,
.allocation-section,
.chart-section {
  background: #16213e;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

.loot-section h2,
.allocation-section h2,
.chart-section h2 {
  font-family: 'Cinzel', serif;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.loot-section h2 i,
.allocation-section h2 i,
.chart-section h2 i {
  color: #e94560;
}

.empty-loot {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-loot i {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
  color: rgba(233, 69, 96, 0.3);
}

.loot-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 20px 0;
}

.loot-card {
  width: 80px;
  height: 80px;
  border: 2px solid;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  position: relative;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
  animation: lootIn 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) both;
  overflow: hidden;
}

@keyframes lootIn {
  from {
    opacity: 0;
    transform: scale(0.5) rotate(-10deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

.loot-card:hover {
  transform: scale(1.1);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.loot-card.selected {
  transform: scale(1.1);
  box-shadow: 0 0 20px currentColor;
}

.loot-quality-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.loot-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 28px;
  color: rgba(255, 255, 255, 0.8);
}

.loot-quality-badge {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}

.item-tooltip {
  position: fixed;
  background: rgba(22, 33, 62, 0.98);
  border: 1px solid rgba(233, 69, 96, 0.5);
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 200px;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.tooltip-name {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 4px;
}

.tooltip-slot {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 8px;
}

.tooltip-stats {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 8px;
  margin-bottom: 8px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 2px;
}

.stat-value {
  color: #1EFF00;
  font-weight: 600;
}

.tooltip-dkp {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.tooltip-dkp span {
  color: #e94560;
  font-weight: 700;
}

.selected-item-info {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.selected-item-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.selected-item-icon {
  font-size: 32px;
}

.selected-item-name {
  font-size: 16px;
  font-weight: 700;
}

.selected-item-detail {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 2px;
}

.mode-switch {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.mode-btn {
  flex: 1;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.mode-btn.active {
  background: rgba(233, 69, 96, 0.2);
  border-color: #e94560;
  color: #e94560;
}

.bidding-panel h4,
.rolling-panel h4 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.bidding-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.bid-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 8px 12px;
}

.bid-player-class {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
}

.bid-player-name {
  font-size: 12px;
  color: #fff;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bid-player-dkp {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

.bid-input {
  width: 60px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  text-align: center;
  flex-shrink: 0;
}

.bid-input:focus {
  outline: none;
  border-color: #e94560;
}

.rolling-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0 0 12px;
}

.eligible-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.eligible-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid;
  border-radius: 20px;
  font-size: 12px;
  color: #fff;
}

.btn-allocate {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #e94560, #ff6b6b);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  border-radius: 8px;
}

.btn-allocate:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(233, 69, 96, 0.5);
}

.btn-allocate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.chart-container {
  height: 280px;
  position: relative;
}

.empty-chart {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
}

.empty-chart i {
  font-size: 48px;
  margin-bottom: 12px;
  color: rgba(233, 69, 96, 0.3);
}

.history-toggle {
  display: none;
  width: 100%;
  padding: 14px;
  background: #16213e;
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 8px;
  color: #e94560;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.history-toggle:hover {
  background: rgba(233, 69, 96, 0.1);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.result-modal {
  background: linear-gradient(135deg, #16213e, #1a1a2e);
  border: 2px solid #e94560;
  border-radius: 16px;
  padding: 32px;
  text-align: center;
  max-width: 400px;
  width: 90%;
  animation: modalIn 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55);
  box-shadow: 0 20px 60px rgba(233, 69, 96, 0.3);
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: translateY(50px) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-header {
  margin-bottom: 24px;
}

.modal-header i {
  font-size: 36px;
  color: #e94560;
  display: block;
  margin-bottom: 8px;
}

.modal-header h3 {
  font-family: 'Cinzel', serif;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  margin: 0;
}

.result-item-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
  border: 3px solid;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
}

.result-item-icon i {
  font-size: 36px;
}

.result-item-name {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}

.result-arrow {
  margin: 12px 0;
}

.result-arrow i {
  font-size: 24px;
  color: #e94560;
  animation: bounce 1s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(5px); }
}

.result-winner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.winner-class-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.winner-class-icon i {
  font-size: 20px;
}

.winner-name {
  font-size: 20px;
  font-weight: 700;
}

.result-dkp,
.result-roll {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 8px;
}

.dkp-spent {
  color: #e94560;
  font-weight: 700;
  font-size: 18px;
}

.roll-value {
  color: #e94560;
  font-weight: 700;
  font-size: 18px;
  font-family: 'Cinzel', serif;
}

.btn-close {
  margin-top: 16px;
  width: 100%;
  padding: 14px;
  font-size: 15px;
}

@media (max-width: 768px) {
  .mobile-header {
    display: flex;
  }

  .sidebar {
    top: 60px;
    width: 100%;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .main-content {
    margin-left: 0;
    margin-top: 60px;
    padding: 20px 16px;
  }

  .main-header {
    flex-direction: column;
    align-items: stretch;
  }

  .main-header h1 {
    font-size: 20px;
  }

  .history-toggle {
    display: block;
  }

  .bidding-grid {
    grid-template-columns: 1fr;
  }

  .loot-grid {
    justify-content: center;
  }

  .result-modal {
    padding: 24px 16px;
  }
}
</style>
