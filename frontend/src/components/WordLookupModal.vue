<template>
  <StrokeLookupModal v-if="modelValue && language === 'zh'" :model-value="true" :child-id="childId" :initial-char="query" unified
    @update:model-value="$emit('update:modelValue', $event)" @switch-query="switchQuery" />
  <EnglishLookupModal v-else-if="modelValue" :model-value="true" :child-id="childId" :initial-word="query" unified
    @update:model-value="$emit('update:modelValue', $event)" @switch-query="switchQuery" />
</template>

<script setup>
import { ref, watch } from 'vue';
import StrokeLookupModal from './StrokeLookupModal.vue';
import EnglishLookupModal from './EnglishLookupModal.vue';
import { useAsyncScope } from '../composables/useAsyncScope';

const props = defineProps({ modelValue: Boolean, childId: { type: String, required: true } });
const emit = defineEmits(['update:modelValue']);
const language = ref('zh'), query = ref('');
watch(() => props.modelValue, open => {
  if (open) { language.value = 'zh'; query.value = ''; }
});
useAsyncScope(() => [props.childId], () => emit('update:modelValue', false));
function switchQuery(next) {
  if (!props.modelValue || !['zh', 'en'].includes(next.language)) return;
  query.value = next.text; language.value = next.language;
}
</script>
