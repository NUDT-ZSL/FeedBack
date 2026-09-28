<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar } from 'vue-chartjs'
import { useDiaryStore } from '@/modules/diary/diaryStore'
import { EMOTION_LABELS, EMOTION_COLORS, type EmotionType } from '@/types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const store = useDiaryStore()

const isLoaded = ref(false)

onMounted(() => {
  setTimeout(() => {
    isLoaded.value = true
  }, 100)
})

const emotions: EmotionType[] = ['happy', 'anxious', 'angry', 'sad', 'peaceful']

const chartData = computed(() => {
  const stats = store.thisWeekEmotionStats
  return {
    labels: emotions.map(e => EMOTION_LABELS[e]),
    datasets: [
      {
        label: '本周天数',
        data: emotions.map(e => stats[e]),
        backgroundColor: emotions.map(e => EMOTION_COLORS[e]),
        borderRadius: 8,
        borderSkipped: false,
        barThickness: 40
      }
    ]
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false
    },
    title: {
      display: true,
      text: '本周情绪分布',
      font: {
        size: 18,
        weight: 600
      },
      color: '#333',
      padding: {
        top: 10,
        bottom: 30
      }
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleFont: {
        size: 14
      },
      bodyFont: {
        size: 13
      },
      padding: 12,
      cornerRadius: 8,
      callbacks: {
        label: (context: any) => `${context.parsed.y} 天`
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        color: '#666',
        font: {
          size: 13
        }
      }
    },
    y: {
      beginAtZero: true,
      suggestedMax: 7,
      grid: {
        color: 'rgba(0, 0, 0, 0.06)'
      },
      ticks: {
        color: '#666',
        font: {
          size: 12
        },
        stepSize: 1,
        callback: (value: any) => `${value} 天`
      }
    }
  }
}))

const totalEntries = computed(() => store.entries.length)

const dominantEmotion = computed(() => {
  const stats = store.thisWeekEmotionStats
  let max: EmotionType = 'peaceful'
  let maxCount = 0
  emotions.forEach(e => {
    if (stats[e] > maxCount) {
      maxCount = stats[e]
      max = e
    }
  })
  return { emotion: max, count: maxCount }
})
</script>

<template>
  <div v-if="isLoaded" class="chart-wrapper fade-in">
    <div class="chart-container">
      <Bar :data="chartData" :options="chartOptions" />
    </div>

    <div class="stats-row">
      <div class="stat-item">
        <div class="stat-number">{{ totalEntries }}</div>
        <div class="stat-label">累计日记</div>
      </div>
      <div class="stat-item">
        <div class="stat-emoji" :style="{ color: EMOTION_COLORS[dominantEmotion.emotion] }">
          {{ EMOTION_LABELS[dominantEmotion.emotion] }}
        </div>
        <div class="stat-label">本周主导情绪</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">{{ dominantEmotion.count }}</div>
        <div class="stat-label">该情绪天数</div>
      </div>
    </div>

    <div v-if="totalEntries === 0" class="empty-tip">
      <div class="empty-icon">📝</div>
      <p>还没有日记数据，去写第一篇心情日记吧～</p>
    </div>
  </div>
</template>

<style scoped>
.chart-wrapper {
  padding: 8px;
}

.chart-container {
  height: 320px;
  position: relative;
}

.stats-row {
  display: flex;
  justify-content: space-around;
  margin-top: 24px;
  padding: 20px 0;
  border-top: 1px solid #f0f0f0;
}

.stat-item {
  text-align: center;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1.2;
}

.stat-emoji {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
  color: #888;
  margin-top: 6px;
}

.empty-tip {
  text-align: center;
  padding: 40px 20px;
  color: #888;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-tip p {
  font-size: 14px;
}
</style>
