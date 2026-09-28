<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDiaryStore } from '@/modules/diary/diaryStore'
import { EMOTION_COLORS, type EmotionType } from '@/types'

const store = useDiaryStore()

const editorRef = ref<HTMLDivElement | null>(null)
const selectedTags = ref<string[]>([])
const newTagName = ref('')
const showNewTagInput = ref(false)
const isSubmitting = ref(false)

const resultEmotion = ref<EmotionType | null>(null)
const resultEmotionLabel = ref('')
const resultTips = ref<string[]>([])
const showResult = ref(false)

const MIN_LENGTH = 300
const MAX_LENGTH = 800

const wordCount = ref(0)

const isOverMax = computed(() => wordCount.value > MAX_LENGTH)
const isUnderMin = computed(() => wordCount.value < MIN_LENGTH)
const canSubmit = computed(() =>
  wordCount.value >= MIN_LENGTH &&
  wordCount.value <= MAX_LENGTH &&
  selectedTags.value.length >= 1 &&
  selectedTags.value.length <= 3 &&
  !isSubmitting.value
)

const lengthStatusText = computed(() => {
  if (wordCount.value === 0) return `请输入 ${MIN_LENGTH}-${MAX_LENGTH} 字`
  if (isUnderMin.value) return `还差 ${MIN_LENGTH - wordCount.value} 字`
  if (isOverMax.value) return `已超出 ${wordCount.value - MAX_LENGTH} 字`
  return `已输入 ${wordCount.value} 字 ✓`
})

const updateWordCount = () => {
  if (editorRef.value) {
    const text = editorRef.value.innerText || ''
    wordCount.value = text.replace(/\s/g, '').length
  }
}

const execCommand = (command: string, value?: string) => {
  document.execCommand(command, false, value)
  editorRef.value?.focus()
  updateWordCount()
}

const insertBold = () => execCommand('bold')
const insertItalic = () => execCommand('italic')
const insertUnderline = () => execCommand('underline')
const insertUnorderedList = () => execCommand('insertUnorderedList')
const insertOrderedList = () => execCommand('insertOrderedList')

const toggleTag = (tagName: string) => {
  const index = selectedTags.value.indexOf(tagName)
  if (index === -1) {
    if (selectedTags.value.length < 3) {
      selectedTags.value.push(tagName)
    }
  } else {
    selectedTags.value.splice(index, 1)
  }
}

const isTagSelected = (tagName: string) => selectedTags.value.includes(tagName)

const addNewTag = () => {
  const name = newTagName.value.trim()
  if (name && !store.tags.some(t => t.name === name)) {
    store.addTag(name)
    if (selectedTags.value.length < 3) {
      selectedTags.value.push(name)
    }
    newTagName.value = ''
  }
  showNewTagInput.value = false
}

const submitDiary = async () => {
  if (!canSubmit.value || !editorRef.value) return

  isSubmitting.value = true
  const content = editorRef.value.innerHTML

  await new Promise(resolve => setTimeout(resolve, 300))

  const result = store.addEntry(content, [...selectedTags.value])

  resultEmotion.value = result.entry.emotion
  resultEmotionLabel.value = result.emotionLabel
  resultTips.value = result.tips
  showResult.value = true

  editorRef.value.innerHTML = ''
  wordCount.value = 0
  selectedTags.value = []
  isSubmitting.value = false
}

const closeResult = () => {
  showResult.value = false
  resultEmotion.value = null
  resultEmotionLabel.value = ''
  resultTips.value = []
}

watch(() => store.tags, (tags) => {
  selectedTags.value = selectedTags.value.filter(
    name => tags.some(t => t.name === name)
  )
}, { deep: true })
</script>

<template>
  <div class="editor-wrapper fade-in">
    <div class="editor-header">
      <h2 class="editor-title">📝 今天的心情日记</h2>
      <p class="editor-subtitle">记录你的感受，让AI为你分析情绪</p>
    </div>

    <div class="toolbar">
      <button type="button" class="tool-btn" @click="insertBold" title="加粗">
        <strong>B</strong>
      </button>
      <button type="button" class="tool-btn" @click="insertItalic" title="斜体">
        <em>I</em>
      </button>
      <button type="button" class="tool-btn" @click="insertUnderline" title="下划线">
        <u>U</u>
      </button>
      <div class="tool-divider"></div>
      <button type="button" class="tool-btn" @click="insertUnorderedList" title="无序列表">
        • 列表
      </button>
      <button type="button" class="tool-btn" @click="insertOrderedList" title="有序列表">
        1. 列表
      </button>
    </div>

    <div
      ref="editorRef"
      class="rich-editor"
      contenteditable="true"
      @input="updateWordCount"
      @paste="updateWordCount"
      :class="{ 'error': isOverMax }"
      placeholder="在这里写下今天的心情..."
    ></div>

    <div class="word-count" :class="{
      'under': isUnderMin && wordCount.value > 0,
      'over': isOverMax,
      'ok': !isUnderMin && !isOverMax
    }">
      {{ lengthStatusText }}
    </div>

    <div class="tags-section">
      <div class="tags-header">
        <span class="tags-label">选择标签 (1-3个)</span>
        <button type="button" class="add-tag-btn" @click="showNewTagInput = true">
          + 新建标签
        </button>
      </div>

      <div v-if="showNewTagInput" class="new-tag-row">
        <input
          v-model="newTagName"
          type="text"
          class="new-tag-input"
          placeholder="输入新标签名"
          maxlength="10"
          @keyup.enter="addNewTag"
          @keyup.esc="showNewTagInput = false; newTagName.value = ''"
        />
        <button type="button" class="btn-secondary" @click="addNewTag">添加</button>
        <button type="button" class="btn-secondary" @click="showNewTagInput = false; newTagName = ''">取消</button>
      </div>

      <div class="tags-list">
        <span
          v-for="tag in store.tags"
          :key="tag.name"
          class="tag"
          :class="{ active: isTagSelected(tag.name) }"
          :style="{ backgroundColor: tag.color }"
          @click="toggleTag(tag.name)"
        >
          {{ tag.name }}
        </span>
      </div>
      <p v-if="selectedTags.length === 0" class="tags-hint">请至少选择1个标签</p>
    </div>

    <div class="submit-row">
      <button
        type="button"
        class="btn-primary submit-btn"
        :disabled="!canSubmit"
        @click="submitDiary"
      >
        {{ isSubmitting ? '分析中...' : '提交并分析情绪' }}
      </button>
    </div>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showResult" class="result-modal-overlay" @click.self="closeResult">
          <div class="result-modal card">
            <button class="close-btn" @click="closeResult">×</button>
            <div class="result-icon">💫</div>
            <h3 class="result-title">AI 情绪分析结果</h3>

            <div
              class="result-emotion"
              v-if="resultEmotion"
              :style="{ backgroundColor: EMOTION_COLORS[resultEmotion] + '22', color: EMOTION_COLORS[resultEmotion] }"
            >
              <span class="emotion-dot" :style="{ backgroundColor: EMOTION_COLORS[resultEmotion] }"></span>
              识别到情绪：<strong>{{ resultEmotionLabel }}</strong>
            </div>

            <div class="result-tips">
              <h4>💡 疗愈小贴士</h4>
              <ul>
                <li v-for="(tip, idx) in resultTips" :key="idx">{{ tip }}</li>
              </ul>
            </div>

            <button class="btn-primary" @click="closeResult">我知道了</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.editor-wrapper {
  width: 100%;
}

.editor-header {
  margin-bottom: 20px;
}

.editor-title {
  font-size: 22px;
  color: #222;
  margin-bottom: 6px;
}

.editor-subtitle {
  font-size: 14px;
  color: #888;
}

.toolbar {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  background: #f8f9fa;
  border-radius: 12px 12px 0 0;
  border: 1px solid #e9ecef;
  border-bottom: none;
  flex-wrap: wrap;
}

.tool-btn {
  background: #fff;
  border: 1px solid #dee2e6;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #495057;
  min-width: 36px;
}

.tool-btn:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}

.tool-divider {
  width: 1px;
  background: #dee2e6;
  margin: 0 6px;
}

.rich-editor {
  min-height: 240px;
  max-height: 400px;
  padding: 20px;
  border: 1px solid #e9ecef;
  border-radius: 0 0 12px 12px;
  background: #fff;
  overflow-y: auto;
  font-size: 15px;
  line-height: 1.8;
  color: #333;
  transition: border-color 0.2s ease;
}

.rich-editor:focus {
  outline: none;
  border-color: #667eea;
}

.rich-editor:empty:before {
  content: attr(placeholder);
  color: #aaa;
  pointer-events: none;
}

.rich-editor.error {
  border-color: #ff4757;
  background: #fff5f5;
}

.rich-editor :deep(b),
.rich-editor :deep(strong) {
  font-weight: 700;
}

.rich-editor :deep(i),
.rich-editor :deep(em) {
  font-style: italic;
}

.rich-editor :deep(u) {
  text-decoration: underline;
}

.rich-editor :deep(ul),
.rich-editor :deep(ol) {
  padding-left: 28px;
  margin: 8px 0;
}

.rich-editor :deep(ul) {
  list-style: disc;
}

.rich-editor :deep(ol) {
  list-style: decimal;
}

.word-count {
  margin-top: 10px;
  text-align: right;
  font-size: 13px;
  color: #999;
}

.word-count.under {
  color: #ff9800;
}

.word-count.over {
  color: #ff4757;
}

.word-count.ok {
  color: #4caf50;
}

.tags-section {
  margin-top: 24px;
}

.tags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tags-label {
  font-size: 14px;
  font-weight: 600;
  color: #444;
}

.add-tag-btn {
  background: transparent;
  color: #667eea;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 6px;
}

.add-tag-btn:hover {
  background: rgba(102, 126, 234, 0.08);
}

.new-tag-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.new-tag-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
}

.new-tag-input:focus {
  border-color: #667eea;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tags-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #ff9800;
}

.submit-row {
  margin-top: 28px;
  display: flex;
  justify-content: flex-end;
}

.submit-btn {
  padding: 12px 28px;
  font-size: 15px;
}

.result-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.result-modal {
  width: 100%;
  max-width: 420px;
  text-align: center;
  position: relative;
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 16px;
  background: transparent;
  font-size: 24px;
  color: #999;
  line-height: 1;
  padding: 4px;
}

.close-btn:hover {
  color: #333;
}

.result-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.result-title {
  font-size: 20px;
  color: #222;
  margin-bottom: 16px;
}

.result-emotion {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 24px;
  font-size: 15px;
  margin-bottom: 20px;
}

.emotion-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.result-tips {
  text-align: left;
  margin-bottom: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 12px;
}

.result-tips h4 {
  font-size: 14px;
  color: #444;
  margin-bottom: 10px;
}

.result-tips ul {
  list-style: none;
  padding: 0;
}

.result-tips li {
  font-size: 14px;
  color: #555;
  line-height: 1.7;
  padding-left: 16px;
  position: relative;
}

.result-tips li + li {
  margin-top: 6px;
}

.result-tips li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #667eea;
  font-weight: bold;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active .result-modal,
.modal-leave-active .result-modal {
  transition: transform 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .result-modal,
.modal-leave-to .result-modal {
  transform: translateY(20px) scale(0.95);
}

@media (max-width: 768px) {
  .editor-title {
    font-size: 18px;
  }

  .rich-editor {
    min-height: 200px;
    padding: 14px;
    font-size: 14px;
  }

  .tool-btn {
    padding: 5px 10px;
    font-size: 12px;
  }

  .submit-btn {
    width: 100%;
    padding: 14px;
  }
}
</style>
