<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="chat-overlay" @click.self="$emit('close')">
        <div class="chat-modal">
          <div class="chat-header">
            <img v-if="landlord" :src="landlord.avatar" class="avatar" />
            <div class="header-info">
              <h3>{{ landlord?.name || '房东' }}</h3>
              <small>在线</small>
            </div>
            <button class="close-btn ripple-btn" v-ripple @click="$emit('close')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#666">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          <div ref="msgListRef" class="chat-messages">
            <TransitionGroup name="msg">
              <div
                v-for="msg in messages"
                :key="msg.id"
                class="msg-item"
                :class="msg.sender"
              >
                <template v-if="msg.type === 'text'">
                  <div class="msg-bubble">{{ msg.content }}</div>
                </template>
                <template v-else>
                  <img :src="msg.content" class="msg-image" />
                </template>
              </div>
            </TransitionGroup>
          </div>
          <div class="chat-input">
            <label class="upload-btn ripple-btn" v-ripple>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="#ff8a65">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
              </svg>
              <input type="file" accept="image/*" @change="handleImage" hidden />
            </label>
            <input
              v-model="inputText"
              type="text"
              placeholder="输入消息..."
              @keydown.enter="sendText"
            />
            <button class="send-btn ripple-btn" v-ripple :disabled="!inputText.trim()" @click="sendText">
              发送
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { useHouseStore } from '@/stores/house'
import type { ChatMessage, House } from '@/types'

const props = defineProps<{
  visible: boolean
  houseId: number
  landlord: House['landlord'] | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useHouseStore()
const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const msgListRef = ref<HTMLDivElement | null>(null)

function scrollBottom() {
  nextTick(() => {
    if (msgListRef.value) {
      msgListRef.value.scrollTop = msgListRef.value.scrollHeight
    }
  })
}

watch(() => props.visible, (val) => {
  if (val && props.houseId) {
    messages.value = store.getChatMessages(props.houseId)
    scrollBottom()
  }
})

watch(() => props.houseId, () => {
  if (props.visible) {
    messages.value = store.getChatMessages(props.houseId)
    scrollBottom()
  }
}, { immediate: false })

watch(() => store.chats, () => {
  if (props.visible) {
    messages.value = store.getChatMessages(props.houseId)
    scrollBottom()
  }
}, { deep: true })

function sendText() {
  const text = inputText.value.trim()
  if (!text || !props.houseId) return
  store.sendChatMessage(props.houseId, 'text', text)
  inputText.value = ''
  scrollBottom()
}

function handleImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !props.houseId) return
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = reader.result as string
    store.sendChatMessage(props.houseId, 'image', base64)
    scrollBottom()
  }
  reader.readAsDataURL(file)
  input.value = ''
}

onMounted(() => {
  if (props.visible && props.houseId) {
    messages.value = store.getChatMessages(props.houseId)
    scrollBottom()
  }
})
</script>

<style scoped>
.chat-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.chat-modal {
  width: 100%;
  max-width: 500px;
  max-height: 85vh;
  background: #faf3e0;
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 8px #ffab91;
  animation: glowBorder 2s ease-in-out infinite alternate;
}
@keyframes glowBorder {
  from { box-shadow: 0 0 8px #ffab91; }
  to { box-shadow: 0 0 14px #ff8a65; }
}
.chat-header {
  padding: 14px 18px;
  background: #fff;
  border-radius: 20px 20px 0 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #f0e6d0;
}
.avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #ffccbc;
}
.header-info h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}
.header-info small {
  color: #66bb6a;
  font-size: 12px;
}
.close-btn {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: #f5f5f5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.chat-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg-item {
  display: flex;
}
.msg-item.landlord {
  justify-content: flex-start;
}
.msg-item.user {
  justify-content: flex-end;
}
.msg-bubble {
  max-width: 75%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}
.landlord .msg-bubble {
  background: #fff;
  color: #333;
  border-top-left-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.user .msg-bubble {
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border-top-right-radius: 4px;
}
.msg-image {
  max-width: 60%;
  max-height: 200px;
  border-radius: 12px;
  object-fit: cover;
  cursor: zoom-in;
}
.chat-input {
  padding: 12px 14px;
  background: #fff;
  border-top: 1px solid #f0e6d0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.upload-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff3e0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  transition: background 0.2s;
}
.upload-btn:hover {
  background: #ffe0b2;
}
.chat-input input[type="text"] {
  flex: 1;
  padding: 10px 14px;
  border: 1.5px solid #ccc;
  border-radius: 20px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.3s;
  background: #fff;
}
.chat-input input[type="text"]:focus {
  border-color: #ff8a65;
}
.send-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.send-btn:not(:disabled):hover {
  transform: translateY(-1px);
}
.ripple-btn {
  position: relative;
  overflow: hidden;
}
.msg-enter-active {
  animation: msgBubble 0.2s ease-out;
}
@keyframes msgBubble {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.modal-enter-active .chat-modal,
.modal-leave-active .chat-modal {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}
.modal-enter-from .chat-modal,
.modal-leave-to .chat-modal {
  transform: translateY(100%);
  opacity: 0.5;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
@media (min-width: 769px) {
  .chat-overlay {
    align-items: center;
  }
  .chat-modal {
    max-height: 75vh;
    border-radius: 20px;
    margin-bottom: 0;
  }
  .chat-header {
    border-radius: 20px 20px 0 0;
  }
}
</style>
