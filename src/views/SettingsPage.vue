<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  getReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  markAllAsRead,
  getUnreadCount
} from '@/modules/notification/ReminderService'
import type { Reminder, EmotionType } from '@/types'
import { EMOTION_LABELS } from '@/types'

const reminders = ref<Reminder[]>([])
const unreadCount = ref(0)

const showAddForm = ref(false)
const newHour = ref(9)
const newMinute = ref(0)
const newTargetEmotion = ref<EmotionType | ''>('')
const newMessage = ref('')

const hours = Array.from({ length: 24 }, (_, i) => i)
const minutes = Array.from({ length: 60 }, (_, i) => i)
const emotionOptions = [
  { value: '', label: '不指定' },
  { value: 'happy', label: '开心' },
  { value: 'anxious', label: '焦虑' },
  { value: 'angry', label: '愤怒' },
  { value: 'sad', label: '悲伤' },
  { value: 'peaceful', label: '平和' }
]

const defaultMessages: Record<EmotionType | '', string> = {
  '': '是时候记录一下今天的心情了～ 💭',
  happy: '今天有什么让你开心的小事呢？快来记录一下吧～',
  anxious: '感觉焦虑吗？写下来可以帮助你梳理情绪哦 🌿',
  angry: '有什么让你生气的事吗？记录下来，给自己一个冷静的机会 🕊️',
  sad: '写日记可以倾诉悲伤，今天想记录点什么呢？💙',
  peaceful: '享受这份宁静，记录下此刻平静的心情吧 🍃'
}

const canAddReminder = computed(() => {
  return newMessage.value.trim().length > 0
})

const pad = (n: number) => n.toString().padStart(2, '0')

const formatTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`

const loadData = () => {
  reminders.value = getReminders()
  unreadCount.value = getUnreadCount()
}

const handleToggle = (id: string, enabled: boolean) => {
  updateReminder(id, { enabled })
  loadData()
}

const handleDelete = (id: string) => {
  if (confirm('确定删除这个提醒吗？')) {
    deleteReminder(id)
    loadData()
  }
}

const handleAdd = () => {
  if (!canAddReminder.value) return

  addReminder({
    enabled: true,
    hour: newHour.value,
    minute: newMinute.value,
    targetEmotion: newTargetEmotion.value || null,
    message: newMessage.value
  })

  newHour.value = 9
  newMinute.value = 0
  newTargetEmotion.value = ''
  newMessage.value = defaultMessages['']
  showAddForm.value = false
  loadData()
}

const handleMarkAllRead = () => {
  markAllAsRead()
  unreadCount.value = 0
}

const updateDefaultMessage = () => {
  newMessage.value = defaultMessages[newTargetEmotion.value || '']
}

onMounted(() => {
  loadData()
  newMessage.value = defaultMessages['']
})
</script>

<template>
  <div class="settings-page fade-in">
    <div class="page-header">
      <h1 class="page-title">⚙️ 情绪提醒设置</h1>
      <p class="page-subtitle">设置每日提醒时间，养成记录心情的好习惯</p>
    </div>

    <div class="card status-card">
      <div class="status-row">
        <div>
          <span class="status-label">未读提醒</span>
          <span class="status-value" :class="{ 'has-count': unreadCount > 0 }">
            {{ unreadCount }} 条
          </span>
        </div>
        <button
          type="button"
          class="btn-secondary"
          :disabled="unreadCount === 0"
          @click="handleMarkAllRead"
        >
          全部已读
        </button>
      </div>
    </div>

    <div class="card">
      <div class="section-header">
        <h3 class="section-title">我的提醒</h3>
        <button type="button" class="btn-primary add-btn" @click="showAddForm = !showAddForm">
          {{ showAddForm ? '取消' : '+ 新增提醒' }}
        </button>
      </div>

      <Transition name="expand">
        <div v-if="showAddForm" class="add-form">
          <div class="form-row">
            <label class="form-label">提醒时间</label>
            <div class="time-picker">
              <select v-model.number="newHour" class="time-select">
                <option v-for="h in hours" :key="h" :value="h">{{ pad(h) }}</option>
              </select>
              <span class="time-sep">:</span>
              <select v-model.number="newMinute" class="time-select">
                <option v-for="m in minutes" :key="m" :value="m">{{ pad(m) }}</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">目标情绪</label>
            <select
              v-model="newTargetEmotion"
              class="form-select"
              @change="updateDefaultMessage"
            >
              <option v-for="opt in emotionOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div class="form-row">
            <label class="form-label">提醒内容</label>
            <input
              v-model="newMessage"
              type="text"
              class="form-input"
              placeholder="输入提醒内容"
              maxlength="50"
            />
          </div>

          <div class="form-actions">
            <button
              type="button"
              class="btn-primary"
              :disabled="!canAddReminder"
              @click="handleAdd"
            >
              添加提醒
            </button>
          </div>
        </div>
      </Transition>

      <div v-if="reminders.length === 0" class="empty-list">
        暂无提醒，点击上方按钮添加一个吧～
      </div>

      <div v-else class="reminder-list">
        <div
          v-for="reminder in reminders"
          :key="reminder.id"
          class="reminder-item"
        >
          <div class="reminder-info">
            <div class="reminder-time">{{ formatTime(reminder.hour, reminder.minute) }}</div>
            <div class="reminder-message">{{ reminder.message }}</div>
            <div v-if="reminder.targetEmotion" class="reminder-emotion">
              目标情绪：{{ EMOTION_LABELS[reminder.targetEmotion] }}
            </div>
          </div>
          <div class="reminder-actions">
            <label class="switch">
              <input
                type="checkbox"
                :checked="reminder.enabled"
                @change="handleToggle(reminder.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider round"></span>
            </label>
            <button type="button" class="btn-danger" @click="handleDelete(reminder.id)">
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card tips-card">
      <h4 class="tips-title">💡 小提示</h4>
      <ul class="tips-list">
        <li>提醒功能需要浏览器通知权限，请确保已允许</li>
        <li>每天的同一提醒只会触发一次</li>
        <li>如果提醒没有出现，请检查浏览器通知设置</li>
        <li>保持页面在后台打开可以持续接收提醒</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 700px;
  margin: 0 auto;
}

.page-header {
  text-align: center;
  margin-bottom: 28px;
  color: #fff;
}

.page-title {
  font-size: 28px;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  opacity: 0.9;
}

.card + .card {
  margin-top: 20px;
}

.status-card {
  margin-bottom: 20px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-label {
  font-size: 14px;
  color: #666;
  margin-right: 12px;
}

.status-value {
  font-size: 20px;
  font-weight: 600;
  color: #444;
}

.status-value.has-count {
  color: #ff4757;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-title {
  font-size: 18px;
  color: #222;
}

.add-btn {
  padding: 8px 18px;
  font-size: 13px;
}

.add-form {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.form-row {
  margin-bottom: 16px;
}

.form-row:last-of-type {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 8px;
}

.time-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}

.time-select {
  width: 70px;
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 15px;
  text-align: center;
  background: #fff;
}

.time-sep {
  font-size: 18px;
  font-weight: 600;
  color: #666;
}

.form-select,
.form-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}

.form-select:focus,
.form-input:focus,
.time-select:focus {
  outline: none;
  border-color: #667eea;
}

.form-actions {
  margin-top: 20px;
  text-align: right;
}

.empty-list {
  text-align: center;
  padding: 40px 20px;
  color: #999;
  font-size: 14px;
}

.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reminder-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #fafbfc;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  transition: all 0.2s ease;
}

.reminder-item:hover {
  border-color: #e0e0e0;
  background: #fff;
}

.reminder-info {
  flex: 1;
}

.reminder-time {
  font-size: 24px;
  font-weight: 700;
  color: #222;
  margin-bottom: 4px;
}

.reminder-message {
  font-size: 14px;
  color: #555;
  margin-bottom: 4px;
}

.reminder-emotion {
  font-size: 12px;
  color: #667eea;
  font-weight: 500;
}

.reminder-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 16px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.3s;
  border-radius: 26px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.switch input:checked + .slider {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.switch input:checked + .slider:before {
  transform: translateX(20px);
}

.tips-card {
  background: rgba(255, 255, 255, 0.95);
}

.tips-title {
  font-size: 15px;
  color: #333;
  margin-bottom: 12px;
}

.tips-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tips-list li {
  font-size: 13px;
  color: #666;
  line-height: 1.8;
  padding-left: 18px;
  position: relative;
}

.tips-list li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #667eea;
  font-weight: bold;
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
  padding-top: 0;
  padding-bottom: 0;
  margin-bottom: 0;
}

.expand-enter-to,
.expand-leave-from {
  max-height: 500px;
}

@media (max-width: 768px) {
  .page-title {
    font-size: 22px;
  }

  .reminder-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .reminder-actions {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
}
</style>
