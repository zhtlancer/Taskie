<template>
  <!-- ⑥ When each day's homework was finished; one series, so no legend box -->
  <div class="h-56">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup>
import { businessDate } from '../utils/businessDate.js';
import { useCalendarStore } from '../stores/calendar';
import { useChartTheme, useChartInk } from '../utils/chartTheme';
const chartInk = useChartInk();
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { SUBJECT_COLORS } from '../utils/timeStats.js';
import { WEEKDAY_NAMES } from '../utils/schedule.js';
const calendar = useCalendarStore();

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

const props = defineProps({ days: { type: Array, required: true } });
// Today's evening is not over, so its latest completion so far is left out.
const days = computed(() => props.days.filter(day => day.date < businessDate(Date.now(), calendar.timeZone)));

// Evening minutes: times before 04:00 belong to the evening before and sort after midnight.
const toMinutes = time => {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return (h < 4 ? h + 24 : h) * 60 + m;
};
const toClock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const values = computed(() => days.value.map(day => toMinutes(day.finished_at)));
const known = computed(() => values.value.filter(v => v !== null));
const color = SUBJECT_COLORS['语文'];
const label = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

const chartData = computed(() => ({
  labels: days.value.map(day => days.value.length > 14 ? `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}` : label(day.date)),
  datasets: [{
    label: '写完时间', data: values.value, borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: 4, pointHoverRadius: 6, pointBorderColor: chartInk.value.surface, pointBorderWidth: 2, pointHitRadius: 12,
    spanGaps: false, tension: 0, borderJoinStyle: 'round', borderCapStyle: 'round'
  }]
}));

const chartOptions = useChartTheme(computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1E293B', padding: 10, cornerRadius: 10,
      filter: item => item.raw !== null,
      callbacks: { title: items => label(days.value[items[0].dataIndex].date), label: item => ` 写完时间 ${toClock(item.raw)}` }
    }
  },
  scales: {
    x: { grid: { display: false }, border: { color: chartInk.value.axis }, ticks: { color: chartInk.value.muted, font: { size: 11, weight: '600' }, autoSkip: true, maxRotation: 0 } },
    y: {
      // Whole hours around the earliest and latest finish.
      min: known.value.length ? Math.floor((Math.min(...known.value) - 30) / 60) * 60 : 17 * 60,
      max: known.value.length ? Math.ceil((Math.max(...known.value) + 30) / 60) * 60 : 22 * 60,
      grid: { color: chartInk.value.grid }, border: { display: false },
      ticks: { stepSize: 60, color: chartInk.value.muted, font: { size: 11 }, callback: value => toClock(value) }
    }
  }
})));
</script>
