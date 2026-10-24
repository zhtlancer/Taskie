<template>
  <UiDialog v-if="confirmation" :key="dialogKey" :title="confirmation.title" confirmation @close="settleConfirmation(null)">
    <p class="text-sm leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ confirmation.message }}</p>
    <form v-if="confirmation.input" id="confirmation-form" class="mt-4" @submit.prevent="submit">
      <label class="block text-sm font-bold text-slate-600 dark:text-slate-300">原因<input v-model="value" autofocus maxlength="50" required class="ui-input w-full mt-2" /></label>
    </form>
    <template #footer>
      <button type="button" class="ui-button-secondary" @click="settleConfirmation(null)">取消</button>
      <button :type="confirmation.input ? 'submit' : 'button'" :form="confirmation.input ? 'confirmation-form' : undefined" class="ui-button-primary"
        :class="confirmation.tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : ''" @click="!confirmation.input && submit()">{{ confirmation.confirmText || '确认' }}</button>
    </template>
  </UiDialog>
</template>
<script setup>
import { ref, watch } from 'vue';
import UiDialog from './UiDialog.vue';
import { useRoute } from 'vue-router';
import { confirmation, settleConfirmation, cancelConfirmations } from '../utils/confirmation';
const route = useRoute();
const value = ref(''), dialogKey = ref(0);
watch(confirmation, current => { value.value = current?.initial || ''; dialogKey.value++; });
// Browser back/forward must not leave a confirmation acting on a page already left.
watch(() => route.fullPath, cancelConfirmations, { flush: 'sync' });
function submit() {
  if (!confirmation.value) return;
  if (confirmation.value.input && !value.value.trim()) return;
  settleConfirmation(confirmation.value.input ? value.value.trim() : true);
}
</script>
