<template>
  <div class="h-44">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup>
import { useChartTheme, useChartInk } from '../utils/chartTheme';
const chartInk = useChartInk();
import { computed } from 'vue';
import { Chart as ChartJS, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale, Filler } from 'chart.js';
import { Line } from 'vue-chartjs';
import { goalChartDates } from '../utils/goalDates';

ChartJS.register(Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale, Filler);

const props = defineProps({
  goal: { type: Object, required: true },
  today: { type: String, required: true }
});

const dates = computed(() => goalChartDates(props.goal, props.today));

const chartData = computed(() => {
  const goal = props.goal;
  const byDate = new Map();
  for (const log of goal.logs) byDate.set(log.date, (byDate.get(log.date) || 0) + log.amount);
  // Cumulative progress up to each day; nothing is drawn for days still ahead.
  let running = goal.logs.filter(log => log.date < dates.value[0]).reduce((sum, log) => sum + log.amount, 0);
  const progress = dates.value.map(date => {
    running += byDate.get(date) || 0;
    return date <= props.today ? Math.min(running, goal.total_amount) : null;
  });
  const datasets = [{
    label: goal.input_mode === 'position' ? `读到第几${goal.unit || ''}` : `累计完成（${goal.unit || '次'}）`,
    data: progress,
    borderColor: '#6366F1',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    fill: true,
    tension: 0.25,
    pointRadius: 2
  }];
  if (goal.end_date) {
    const span = Math.max(1, (new Date(`${goal.end_date}T00:00:00Z`) - new Date(`${goal.start_date}T00:00:00Z`)) / 86400000 + 1);
    datasets.push({
      label: '计划进度',
      data: dates.value.map(date => Math.round(goal.total_amount * ((new Date(`${date}T00:00:00Z`) - new Date(`${goal.start_date}T00:00:00Z`)) / 86400000 + 1) / span)),
      borderColor: '#F59E0B',
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false
    });
  }
  return { labels: dates.value.map(date => date.slice(5).replace('-', '/')), datasets };
});

const chartOptions = useChartTheme(computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: Boolean(props.goal.end_date), labels: { boxWidth: 12, font: { size: 11 } } } },
  scales: {
    y: { min: 0, max: props.goal.total_amount, ticks: { font: { size: 11 } } },
    x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 8 } }
  }
})));
</script>
