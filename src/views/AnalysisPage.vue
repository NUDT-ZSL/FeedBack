<script setup lang="ts">
import EmotionChart from '@/modules/analysis/EmotionChart.vue'
</script>

<template>
  <div class="analysis-page fade-in">
    <div class="page-header">
      <h1 class="page-title">📊 情绪分析仪表盘</h1>
      <p class="page-subtitle">查看本周的情绪变化和统计数据</p>
    </div>

    <div class="chart-card card">
      <EmotionChart />
    </div>
  </div>
</template>

<style scoped>
.analysis-page {
  max-width: 800px;
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

.chart-card {
  padding: 32px;
}

@media (max-width: 768px) {
  .page-title {
    font-size: 22px;
  }

  .chart-card {
    padding: 16px;
  }
}
</style>
