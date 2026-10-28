<template>
  <div v-if="result" data-class-homework role="status" class="mt-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 px-3 py-2 text-sm text-sky-800 dark:text-sky-200">
    <p v-if="result.state === 'deleted'">本课次的自动作业已删除，不会重复生成。</p>
    <template v-else>
      <p v-if="retained">更正出勤后，本课次已生成的作业仍保留。</p>
      <p>{{ result.task_id ? `本课次作业已生成，截止 ${result.due_date}` : result.due_date ? '已保存作业记录，未生成任务。截止日期已过时，可修改日期后生成任务。' : '已保存作业记录，待设置截止日期后生成任务。' }}</p>
      <router-link v-if="!disabled" :to="`/child/${childId}/homework#homework-${result.record_id}`" class="inline-flex items-center min-h-[44px] underline font-bold">查看作业</router-link>
      <span v-else aria-disabled="true" class="inline-flex items-center min-h-[44px] font-bold opacity-50">查看作业</span>
    </template>
  </div>
</template>
<script setup>
defineProps({ result: Object, childId: { type: String, required: true }, retained: Boolean, disabled: Boolean });
</script>
