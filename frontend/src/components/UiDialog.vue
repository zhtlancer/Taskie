<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4" @click.self="requestClose">
      <section ref="panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1"
        class="ui-dialog bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 w-full rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col overflow-hidden max-h-[92dvh]" :class="workspace ? 'max-w-5xl h-[760px]' : wide ? 'max-w-2xl' : 'max-w-md'">
        <header class="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <div class="min-w-0"><h2 :id="titleId" class="text-base font-bold"><slot name="title">{{ title }}</slot></h2><div v-if="$slots.subtitle" class="mt-1 text-xs text-slate-500 dark:text-slate-400"><slot name="subtitle" /></div></div>
          <button type="button" :disabled="busy" class="w-11 h-11 shrink-0 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40" :aria-label="closeLabel" @click="requestClose">✕</button>
        </header>
        <div class="min-h-0" :class="workspace ? 'flex-1 flex flex-col overflow-hidden' : 'p-5 overflow-y-auto'" :style="workspace ? { paddingBottom: 'env(safe-area-inset-bottom)' } : !$slots.footer ? { paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' } : undefined"><slot /></div>
        <footer v-if="$slots.footer" class="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0 flex flex-wrap justify-end gap-2"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
<script>
const dialogs = [];
let originalOverflow;
</script>
<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, useId } from 'vue';
const props = defineProps({ title: { type: String, required: true }, busy: Boolean, wide: Boolean, workspace: Boolean, closeLabel: { type: String, default: '关闭' } });
const emit = defineEmits(['close']);
const panel = ref(null), titleId = useId();
let previousFocus;
function requestClose() { if (!props.busy) emit('close'); }
function onKey(event) {
  if (dialogs.at(-1) !== titleId) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); requestClose(); }
  if (event.key !== 'Tab') return;
  const elements = [...panel.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = elements[0], last = elements.at(-1);
  if (!first) { event.preventDefault(); panel.value.focus(); }
  else if (event.shiftKey && (document.activeElement === first || !panel.value.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !panel.value.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}
onMounted(async () => {
  previousFocus = document.activeElement;
  if (!dialogs.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  dialogs.push(titleId);
  document.addEventListener('keydown', onKey, true);
  await nextTick();
  if (dialogs.at(-1) === titleId && panel.value?.isConnected) (panel.value.querySelector('[autofocus]') || panel.value).focus();
});
onBeforeUnmount(() => {
  const index = dialogs.indexOf(titleId);
  if (index >= 0) dialogs.splice(index, 1);
  document.removeEventListener('keydown', onKey, true);
  if (!dialogs.length) document.body.style.overflow = originalOverflow;
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>
