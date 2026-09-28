<script setup lang="ts">
import { computed } from 'vue'
import type { ToolType } from '@/types'
import { PRESET_COLORS, MIN_LINE_WIDTH, MAX_LINE_WIDTH } from '@/types'

interface Props {
  currentTool: ToolType
  currentColor: string
  lineWidth: number
  canUndo: boolean
  canRedo: boolean
  isConnected: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:currentTool', value: ToolType): void
  (e: 'update:currentColor', value: string): void
  (e: 'update:lineWidth', value: number): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'clearCanvas'): void
}>()

const tools: { type: ToolType; icon: string; label: string }[] = [
  { type: 'pen', icon: '✏️', label: '画笔' },
  { type: 'rectangle', icon: '⬜', label: '矩形' },
  { type: 'circle', icon: '⭕', label: '圆形' },
  { type: 'note', icon: '📝', label: '便利贴' }
]

const lineWidthPercent = computed(() => {
  return ((props.lineWidth - MIN_LINE_WIDTH) / (MAX_LINE_WIDTH - MIN_LINE_WIDTH)) * 100
})

function selectTool(tool: ToolType) {
  emit('update:currentTool', tool)
}

function selectColor(color: string) {
  emit('update:currentColor', color)
}

function updateLineWidth(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:lineWidth', Number(target.value))
}
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-inner">
      <div class="tool-group">
        <button
          v-for="tool in tools"
          :key="tool.type"
          :class="['tool-btn', { active: currentTool === tool.type }]"
          :title="tool.label"
          @click="selectTool(tool.type)"
        >
          <span class="tool-icon">{{ tool.icon }}</span>
        </button>
      </div>

      <div class="divider"></div>

      <div class="tool-group">
        <div class="color-picker">
          <button
            v-for="color in PRESET_COLORS"
            :key="color"
            :class="['color-swatch', { active: currentColor === color }]"
            :style="{ backgroundColor: color }"
            :title="color"
            @click="selectColor(color)"
          >
            <span v-if="currentColor === color" class="check-mark">✓</span>
          </button>
        </div>
      </div>

      <div class="divider"></div>

      <div class="tool-group">
        <div class="line-width-control">
          <span class="label">粗细</span>
          <div class="slider-wrapper">
            <input
              type="range"
              :min="MIN_LINE_WIDTH"
              :max="MAX_LINE_WIDTH"
              :value="lineWidth"
              class="slider"
              @input="updateLineWidth"
            />
            <div class="slider-fill" :style="{ width: lineWidthPercent + '%' }"></div>
          </div>
          <div class="line-preview" :style="{ width: lineWidth + 'px', height: lineWidth + 'px', backgroundColor: currentColor }"></div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="tool-group">
        <button
          class="action-btn"
          :class="{ disabled: !canUndo }"
          title="撤销 (Ctrl+Z)"
          @click="emit('undo')"
        >
          ↩️
        </button>
        <button
          class="action-btn"
          :class="{ disabled: !canRedo }"
          title="重做 (Ctrl+Y)"
          @click="emit('redo')"
        >
          ↪️
        </button>
        <button class="action-btn" title="清空画布" @click="emit('clearCanvas')">
          🗑️
        </button>
      </div>

      <div class="divider"></div>

      <div class="tool-group">
        <div class="connection-status" :class="{ connected: isConnected }">
          <span class="status-dot"></span>
          <span class="status-text">{{ isConnected ? '已连接' : '连接中...' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 0 8px;
}

.toolbar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--toolbar-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--toolbar-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.divider {
  width: 1px;
  height: 28px;
  background: var(--toolbar-border);
  margin: 0 4px;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: transparent;
  transition: all var(--transition-fast);
}

.tool-btn:hover {
  background: rgba(0, 0, 0, 0.05);
}

.tool-btn.active {
  background: var(--primary-color);
  box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
}

.tool-btn.active .tool-icon {
  filter: brightness(0) invert(1);
}

.tool-icon {
  font-size: 18px;
  line-height: 1;
}

.color-picker {
  display: flex;
  gap: 6px;
  padding: 0 4px;
}

.color-swatch {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  transition: all var(--transition-fast);
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--primary-color);
}

.check-mark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.line-width-control {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
}

.label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.slider-wrapper {
  position: relative;
  width: 100px;
  height: 4px;
}

.slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  z-index: 2;
}

.slider::-webkit-slider-runnable-track {
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  margin-top: -6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform var(--transition-fast);
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 4px;
  background: var(--primary-color);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}

.line-preview {
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  font-size: 16px;
  transition: all var(--transition-fast);
}

.action-btn:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.05);
}

.action-btn.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: rgba(255, 152, 0, 0.1);
}

.connection-status.connected {
  background: rgba(67, 160, 71, 0.1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff9800;
  animation: pulse 1.5s infinite;
}

.connection-status.connected .status-dot {
  background: #43a047;
  animation: none;
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
