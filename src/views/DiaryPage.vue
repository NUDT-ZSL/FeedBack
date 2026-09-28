<script setup lang="ts">
import DiaryEditor from '@/modules/diary/DiaryEditor.vue'
import DiaryList from '@/modules/diary/DiaryList.vue'
</script>

<template>
  <div class="diary-page">
    <div class="page-grid">
      <div class="editor-column">
        <div class="card">
          <DiaryEditor />
        </div>
      </div>
      <div class="list-column">
        <DiaryList />
      </div>
    </div>
  </div>
</template>

<style scoped>
.diary-page {
  width: 100%;
}

.page-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}

.editor-column {
  position: sticky;
  top: 96px;
}

.list-column {
  min-height: 600px;
}

@media (max-width: 768px) {
  .page-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .editor-column {
    position: static;
  }
}
</style>
