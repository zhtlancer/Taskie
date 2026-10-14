<template>
  <div class="w-full h-full min-h-[260px] flex flex-col justify-center">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale
} from 'chart.js';
import { Bar } from 'vue-chartjs';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const props = defineProps({
  historyData: {
    type: Array,
    default: () => []
  }
});

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const chartData = computed(() => {
  const labels = props.historyData.map(item => {
    if (!item.date) return '';
    const d = new Date(item.date);
    const dayName = weekdayNames[d.getDay()];
    // Days with nothing scheduled are rest days, not failures.
    return item.total_tasks === 0 ? `${d.getMonth() + 1}/${d.getDate()} (${dayName}·休息)` : `${d.getMonth() + 1}/${d.getDate()} (${dayName})`;
  });

  const completionRates = props.historyData.map(item => {
    return item.total_tasks === 0 ? null : Math.round((item.completion_rate || 0) * 100);
  });

  return {
    labels,
    datasets: [
      {
        label: '任务完成率 (%)',
        backgroundColor: completionRates.map(rate => rate >= 100 ? '#10B981' : rate >= 60 ? '#6C63FF' : '#FFD93D'),
        borderRadius: 8,
        borderSkipped: false,
        data: completionRates,
        maxBarThickness: 36
      }
    ]
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      backgroundColor: '#1E293B',
      titleFont: { size: 13, weight: 'bold' },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 10,
      callbacks: {
        label: (context) => context.raw === null ? '休息日：没有安排任务' : `完成率: ${context.raw}%`
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        font: { size: 12, weight: '600' },
        color: '#64748B'
      }
    },
    y: {
      min: 0,
      max: 100,
      ticks: {
        stepSize: 25,
        callback: (val) => `${val}%`,
        font: { size: 11, weight: '600' },
        color: '#94A3B8'
      },
      grid: {
        color: '#F1F5F9'
      }
    }
  }
};
</script>
