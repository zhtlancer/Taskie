<template>
  <div v-if="draft.available || draft.saved || draft.error" class="mb-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 p-3 text-sm text-sky-800 dark:text-sky-200 space-y-2" role="status">
    <p v-if="draft.available">发现这份表单的本机草稿。恢复会替换当前输入，请核对后再提交。</p>
    <p v-else-if="draft.pending">上次保存结果尚未确认，请按原内容重试。需要修改时，请先核对列表，再丢弃草稿重新填写。</p>
    <p v-else-if="draft.saved">草稿已保存在这台设备，保留 7 天。</p>
    <details v-if="draft.available && draft.preview"><summary class="cursor-pointer min-h-[44px] py-3">查看草稿文字</summary><p class="whitespace-pre-wrap break-words select-text">{{ draft.preview }}</p></details>
    <p v-if="draft.error" role="alert">{{ draft.error }}。当前输入仍保留在页面中。</p>
    <div v-if="draft.available || draft.pending" class="flex flex-wrap gap-2">
      <button v-if="draft.available" type="button" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-sky-600 text-white font-bold disabled:opacity-40" @click="draft.restore()">恢复草稿</button>
      <button v-else-if="draft.pending" type="button" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-sky-600 text-white font-bold disabled:opacity-40" @click="$emit('retry')">按原内容重试</button>
      <button type="button" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-900 font-bold disabled:opacity-40" @click="discard">丢弃已存草稿</button>
    </div>
  </div>
</template>
<script setup>
import { confirmAction } from '../utils/confirmation';
const props = defineProps({ draft: { type: Object, required: true }, busy: Boolean });
defineEmits(['retry']);
async function discard() {
  if (props.draft.requiresConfirmation && !await confirmAction('上次操作可能已经保存，请先核对列表。确定丢弃草稿、重新填写吗？')) return;
  props.draft.discard();
}
</script>
