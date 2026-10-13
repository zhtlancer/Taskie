<template>
  <div class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-xl font-bold text-slate-800 flex items-center gap-2">
        <span>💰</span>
        <span>积分获取记录</span>
      </h3>
      <span class="text-xs text-slate-400 font-bold">最近明细</span>
    </div>

    <!-- Empty State -->
    <div v-if="logs.length === 0" class="py-12 text-center text-slate-400 text-sm">
      <div class="text-4xl mb-2">🎁</div>
      完成任务即可获取金币积分哦，快去完成任务吧！
    </div>

    <!-- Log list -->
    <div v-else class="space-y-3 max-h-[360px] overflow-y-auto pr-1">
      <div
        v-for="log in logs"
        :key="log.id"
        class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-brand-50/50 transition-colors"
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl shrink-0">
            🪙
          </div>
          <div>
            <div class="text-sm font-bold text-slate-800">
              {{ log.title || '完成日常作业打卡' }}
            </div>
            <div class="text-[11px] text-slate-400">
              {{ formatTime(log.earned_at) }}
            </div>
          </div>
        </div>

        <div class="text-base font-black text-amber-600 flex items-center gap-1">
          <span>+{{ log.points }}</span>
          <span class="text-xs font-bold text-amber-500">积分</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  logs: {
    type: Array,
    default: () => []
  }
});

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `今天 ${timeStr}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`;
}
</script>
