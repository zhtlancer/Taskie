<template>
  <div class="space-y-3 min-w-0">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block min-w-0 text-sm font-bold">来源（选填）<input :value="modelValue.source" maxlength="60" class="ui-input block mt-1 w-full" placeholder="如 人教版语文三上" @input="set('source', $event.target.value)" /></label>
      <label class="block min-w-0 text-sm font-bold">单元/章节（选填）<input :value="modelValue.unit" maxlength="60" class="ui-input block mt-1 w-full" placeholder="如 第一单元" @input="set('unit', $event.target.value)" /></label>
    </div>
    <div v-if="sources.length" class="flex flex-wrap gap-2"><button v-for="source in sources" :key="source" type="button" class="ui-button-secondary max-w-full break-words [overflow-wrap:anywhere]" @click="set('source', source)">{{ source }}</button></div>
    <label class="block text-sm font-bold">词本名称<input :value="modelValue.name" required maxlength="80" class="ui-input block mt-1 w-full" @input="manualName = true; set('name', $event.target.value)" /></label>
    <label class="block text-sm font-bold">来源类型<select :value="modelValue.source_type" aria-label="来源类型" class="ui-input block mt-1 w-full" @change="set('source_type', $event.target.value)"><option v-for="type in SOURCE_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
    <label class="block text-sm font-bold">备注（选填）<textarea :value="modelValue.note" rows="2" maxlength="200" class="ui-input block mt-1 w-full" @input="set('note', $event.target.value)" /></label>
  </div>
</template>
<script setup>
import { ref } from 'vue';
import { SOURCE_TYPES, formatBookDefaultName } from '../utils/wordBookSource';
const props = defineProps({ modelValue: { type: Object, required: true }, sources: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);
const manualName = ref(Boolean(props.modelValue.name && props.modelValue.name !== formatBookDefaultName(props.modelValue.source, props.modelValue.unit)));
function set(key, value) {
  const next = { ...props.modelValue, [key]: value };
  if (!manualName.value && ['source', 'unit'].includes(key)) next.name = formatBookDefaultName(next.source, next.unit);
  emit('update:modelValue', next);
}
</script>
