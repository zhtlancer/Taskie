<template>
  <!-- ① Each day's homework time, stacked by subject; the estimate for unrecorded tasks sits on top in gray -->
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <!-- Legend with each subject's total: the identity and value channel beside the colors -->
      <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-600">
        <li v-for="item in legend" :key="item.label" class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-sm" :style="{ background: item.color }"></span>
          <span>{{ item.label }}</span>
          <span class="text-slate-400">{{ formatMinutes(item.seconds) }}</span>
        </li>
      </ul>
      <button type="button" class="px-2.5 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600" @click="showTable = !showTable">
        {{ showTable ? '📊 看图' : '📋 看表格' }}
      </button>
    </div>

    <div v-if="!showTable" class="h-64">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
    <div v-else class="max-h-64 overflow-auto rounded-xl border border-slate-100">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-slate-50 text-slate-500">
          <tr>
            <th class="px-2 py-1.5 text-left font-bold">日期</th>
            <th v-for="subject in shownSubjects" :key="subject" class="px-2 py-1.5 text-right font-bold">{{ subject }}</th>
            <th class="px-2 py-1.5 text-right font-bold">合计</th>
            <th v-if="showEstimate" class="px-2 py-1.5 text-right font-bold">含估算</th>
            <th class="px-2 py-1.5 text-right font-bold">没记录</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in days" :key="day.date" class="border-t border-slate-100 text-slate-700">
            <td class="px-2 py-1.5 font-bold">{{ dayLabel(day.date) }}</td>
            <td v-for="subject in shownSubjects" :key="subject" class="px-2 py-1.5 text-right">{{ subjectSeconds(day)[subject] ? formatMinutes(subjectSeconds(day)[subject]) : '–' }}</td>
            <td class="px-2 py-1.5 text-right font-bold">{{ day.recorded_seconds ? formatMinutes(day.recorded_seconds) : '–' }}</td>
            <td v-if="showEstimate" class="px-2 py-1.5 text-right">{{ day.estimated_seconds > day.recorded_seconds ? `约 ${formatMinutes(day.estimated_seconds)}` : '–' }}</td>
            <td class="px-2 py-1.5 text-right">{{ day.missing || '–' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Bar } from 'vue-chartjs';
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { CHART_INK, ESTIMATE_COLOR, SUBJECTS, SUBJECT_COLORS, formatMinutes, subjectOf } from '../utils/timeStats.js';
import { WEEKDAY_NAMES } from '../utils/schedule.js';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const props = defineProps({
  days: { type: Array, required: true },
  // Parents see the estimate for unrecorded tasks; children only what was recorded.
  showEstimate: { type: Boolean, default: false }
});

const showTable = ref(false);
const weekday = date => WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
const dayLabel = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${weekday(date)}`;

// Recorded seconds per subject, any other subject counted as 其他.
function subjectSeconds(day) {
  const totals = {};
  for (const [subject, seconds] of Object.entries(day.by_subject)) totals[subjectOf(subject)] = (totals[subjectOf(subject)] || 0) + seconds;
  return totals;
}

const shownSubjects = computed(() => SUBJECTS.filter(subject => props.days.some(day => subjectSeconds(day)[subject])));
const estimateOf = day => Math.max(0, day.estimated_seconds - day.recorded_seconds);
const hasEstimate = computed(() => props.showEstimate && props.days.some(day => estimateOf(day) > 0));

const legend = computed(() => [
  ...shownSubjects.value.map(subject => ({
    label: subject, color: SUBJECT_COLORS[subject], seconds: props.days.reduce((sum, day) => sum + (subjectSeconds(day)[subject] || 0), 0)
  })),
  ...(hasEstimate.value ? [{ label: '估算（没记录的）', color: ESTIMATE_COLOR, seconds: props.days.reduce((sum, day) => sum + estimateOf(day), 0) }] : [])
]);

const minutes = seconds => Math.round(seconds / 6) / 10;
const series = computed(() => [
  ...shownSubjects.value.map(subject => ({ label: subject, color: SUBJECT_COLORS[subject], values: props.days.map(day => minutes(subjectSeconds(day)[subject] || 0)) })),
  ...(hasEstimate.value ? [{ label: '估算', color: ESTIMATE_COLOR, values: props.days.map(day => minutes(estimateOf(day))) }] : [])
]);

// Only the topmost segment of each column gets the rounded end; segments are parted by a 2px
// surface-colored gap instead of a stroke.
function topRadius(ctx) {
  const top = series.value.map(s => s.values[ctx.dataIndex]).findLastIndex(value => value > 0);
  return ctx.datasetIndex === top ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 0;
}

const chartData = computed(() => ({
  labels: props.days.map(day => props.days.length > 14 ? `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}` : dayLabel(day.date)),
  datasets: series.value.map(s => ({
    label: s.label, data: s.values, backgroundColor: s.color, stack: 'time',
    borderColor: CHART_INK.surface, borderWidth: { top: 2 }, borderSkipped: 'start', borderRadius: topRadius, maxBarThickness: 24
  }))
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1E293B',
      padding: 10,
      cornerRadius: 10,
      filter: item => item.raw > 0,
      callbacks: {
        title: items => {
          const day = props.days[items[0]?.dataIndex];
          return day ? dayLabel(day.date) : '';
        },
        label: item => ` ${item.dataset.label}：${formatMinutes(item.raw * 60)}`,
        footer: items => {
          const day = props.days[items[0]?.dataIndex];
          if (!day) return [];
          return [
            `记录合计 ${formatMinutes(day.recorded_seconds)}`,
            ...(props.showEstimate && estimateOf(day) ? [`含估算约 ${formatMinutes(day.estimated_seconds)}`] : []),
            ...(day.missing ? [`${day.missing} 项没记录用时`] : [])
          ];
        }
      }
    }
  },
  scales: {
    x: { stacked: true, grid: { display: false }, border: { color: CHART_INK.axis }, ticks: { color: CHART_INK.muted, font: { size: 11, weight: '600' }, autoSkip: true, maxRotation: 0 } },
    y: {
      stacked: true, beginAtZero: true,
      grid: { color: CHART_INK.grid }, border: { display: false },
      ticks: { color: CHART_INK.muted, font: { size: 11 }, callback: value => `${value} 分`, maxTicksLimit: 6 }
    }
  }
}));
</script>
