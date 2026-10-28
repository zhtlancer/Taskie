<template>
  <article class="time-stats-report" aria-label="用时统计打印报告">
    <h1>{{ childName }} · 用时统计</h1>
    <p>{{ stats.from }} 至 {{ stats.to }}（含首尾日期） · 家庭时区：{{ timeZone }}</p>
    <p>{{ TIME_STATS_NOTE }}</p>
    <dl>
      <div><dt>已记录用时</dt><dd>{{ formatMinutes(stats.summary.recorded_seconds) }}</dd></div>
      <div><dt>系统补估</dt><dd>{{ formatMinutes(estimateSeconds(stats.summary)) }}</dd></div>
      <div><dt>含估算合计</dt><dd>{{ formatMinutes(stats.summary.estimated_seconds) }}</dd></div>
      <div><dt>未能估算</dt><dd>{{ unestimatedCount(stats.summary) }} 次</dd></div>
    </dl>
    <p>统计 {{ stats.summary.sessions }} 次，未记录 {{ stats.summary.missing }} 次，其中已估算 {{ stats.summary.estimated_missing }} 次。
      平均最后完成时间：{{ stats.summary.finish_average || '无记录' }}（今天不参与平均）。</p>

    <h2>各学科用时</h2>
    <table>
      <thead><tr><th>学科</th><th>已记录</th><th>系统补估</th><th>含估算合计</th><th>未能估算</th></tr></thead>
      <tbody><tr v-for="subject in stats.subjects" :key="subject.subject"><td>{{ subject.subject }}</td><td>{{ formatMinutes(subject.recorded_seconds) }}</td><td>{{ formatMinutes(estimateSeconds(subject)) }}</td><td>{{ formatMinutes(subject.estimated_seconds) }}</td><td>{{ unestimatedCount(subject) }} 次</td></tr></tbody>
    </table>
    <p v-if="!stats.subjects.length">没有数据</p>

    <h2>每项任务的用时</h2>
    <p>平均、最快、最慢仅使用已记录用时。统计次数按现有任务和学习记录口径计算，不等同于计时器启动次数。</p>
    <table>
      <thead><tr><th>任务 / 学科</th><th>已记录 / 总次数</th><th>已记录</th><th>系统补估</th><th>平均</th><th>最快 / 最慢</th><th>未能估算</th></tr></thead>
      <tbody><tr v-for="task in stats.tasks" :key="task.key"><td>{{ task.title }}<br />{{ task.subject }} · {{ taskKindLabel(task.kind) }}</td><td>{{ task.recorded }} / {{ task.sessions }}</td><td>{{ formatMinutes(task.recorded_seconds) }}</td><td>{{ formatMinutes(estimateSeconds(task)) }}</td><td>{{ formatMinutes(task.average_seconds) ?? '—' }}</td><td>{{ formatMinutes(task.min_seconds) ?? '—' }} / {{ formatMinutes(task.max_seconds) ?? '—' }}</td><td>{{ unestimatedCount(task) }} 次</td></tr></tbody>
    </table>
    <p v-if="!stats.tasks.length">没有数据</p>

    <h2>每天的作业用时</h2>
    <p>最后完成时间包括所有任务，事后补记不参与；凌晨 04:00 前的完成时间归入前一晚。没有完成时间时留空。</p>
    <table>
      <thead><tr><th>日期</th><th>已记录</th><th>系统补估</th><th>含估算合计</th><th>未记录 / 已估 / 未估（次）</th><th>最后完成</th></tr></thead>
      <tbody><tr v-for="day in stats.days" :key="day.date"><td>{{ day.date }}</td><td>{{ formatMinutes(day.recorded_seconds) }}</td><td>{{ formatMinutes(estimateSeconds(day)) }}</td><td>{{ formatMinutes(day.estimated_seconds) }}</td><td>{{ day.missing }} / {{ day.estimated_missing }} / {{ unestimatedCount(day) }}</td><td>{{ day.finished_at }}</td></tr></tbody>
    </table>

    <template v-if="stats.goals.length">
      <h2>长期任务的速度</h2>
      <table><thead><tr><th>任务</th><th>有计时的进度</th><th>平均速度</th></tr></thead><tbody><tr v-for="goal in stats.goals" :key="goal.id"><td>{{ goal.title }}</td><td>{{ goal.amount }} {{ goal.unit }}</td><td>每{{ goal.unit }} {{ formatPerUnit(goal.seconds_per_unit) }}</td></tr></tbody></table>
    </template>
  </article>
</template>
<script setup>
import { formatMinutes, formatPerUnit } from '../utils/timeStats.js';
import { estimateSeconds, unestimatedCount, taskKindLabel, TIME_STATS_NOTE } from '../utils/timeStatsReport.js';
defineProps({ stats: { type: Object, required: true }, childName: { type: String, required: true }, timeZone: { type: String, required: true } });
</script>
<style scoped>
.time-stats-report { display: none; }
@media print {
  .time-stats-report { display: block; color: #000; background: #fff; font: 10pt/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
  h1 { font-size: 18pt; font-weight: bold; margin-bottom: 6pt; }
  h2 { font-size: 13pt; font-weight: bold; margin-top: 16pt; break-after: avoid; }
  p { margin: 6pt 0; }
  dl { display: grid; grid-template-columns: repeat(4, 1fr); margin: 12pt 0; gap: 8pt; }
  dd { font-size: 14pt; font-weight: bold; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 6pt; }
  th, td { border: 1px solid #aaa; padding: 4pt; text-align: left; vertical-align: top; }
  th { font-weight: bold; }
  thead { display: table-header-group; }
  tr, dl { break-inside: avoid; }
}
</style>
