<template>
  <div
    class="relative rounded-2xl border-2 p-5 transition-all duration-200 shadow-sm flex flex-col justify-between"
    :class="[
      mistake.is_mastered
        ? 'bg-slate-50 border-slate-200/80 opacity-80'
        : 'bg-white border-brand-100 hover:border-brand-300 hover:shadow-card'
    ]"
  >
    <div>
      <!-- Top header: Subject + Date + Mastered status -->
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span
            class="px-2.5 py-0.5 rounded-lg text-xs font-black"
            :class="subjectColor(mistake.subject)"
          >
            {{ mistake.subject }}
          </span>
          <span class="text-xs text-slate-400">
            {{ formatDate(mistake.created_at) }}
          </span>
        </div>

        <!-- Mastered Badge -->
        <span
          v-if="mistake.is_mastered"
          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold"
        >
          <span>✓</span>
          <span>已攻克掌握</span>
        </span>
        <span
          v-else
          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-600 text-xs font-bold"
        >
          <span>✏️</span>
          <span>待复习</span>
        </span>
      </div>

      <!-- Description -->
      <p
        class="text-base text-slate-700 leading-relaxed font-chinese font-medium mb-4 whitespace-pre-wrap"
        :class="{ 'line-through text-slate-400': mistake.is_mastered }"
      >
        {{ mistake.description }}
      </p>

      <!-- Optional photo attachment preview -->
      <div
        v-if="mistake.photo_path"
        @click="$emit('preview-photo', mistake.photo_path)"
        class="mb-4 rounded-xl overflow-hidden max-h-56 border border-slate-200 cursor-zoom-in relative group transition-all hover:border-brand-300"
        title="点击查看高清大图"
      >
        <img :src="mistake.photo_path" alt="错题图片" class="w-full h-auto object-cover group-hover:scale-[1.02] transition-transform duration-200" />
        <div class="absolute inset-0 bg-slate-900/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
          <span>🔍</span>
          <span>点击查看高清大图</span>
        </div>
      </div>
    </div>

    <!-- Actions Footer -->
    <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
      <!-- Toggle Mastered Button -->
      <button
        type="button"
        @click="$emit('toggle-master', mistake)"
        class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1"
        :class="[
          mistake.is_mastered
            ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-200'
        ]"
      >
        <span>{{ mistake.is_mastered ? '标记为未掌握' : '✓ 标记已掌握' }}</span>
      </button>

      <!-- Delete Button -->
      <button
        type="button"
        @click="$emit('delete', mistake.id)"
        class="text-xs text-slate-400 hover:text-rose-500 font-semibold p-1 transition-colors"
      >
        删除记录
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  mistake: {
    type: Object,
    required: true
  }
});

defineEmits(['toggle-master', 'delete', 'preview-photo']);

function subjectColor(subject) {
  switch (subject) {
    case '语文': return 'bg-rose-100 text-rose-700';
    case '数学': return 'bg-blue-100 text-blue-700';
    case '英语': return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-amber-100 text-amber-800';
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>
