<template>
  <div class="space-y-2" data-english-pronunciations>
    <div v-for="group in displayed" :key="group.id" class="space-y-1 min-w-0 [overflow-wrap:anywhere]">
      <p v-if="group.name" class="text-xs text-slate-500 dark:text-slate-400">{{ pronunciationLabel(group) }}</p>
      <div class="flex flex-wrap gap-2">
        <button v-for="clip in group.clips" :key="clip.id" type="button" class="ui-button-secondary min-h-11" @click="$emit('play', clip.url)">🔊 {{ clip.label }}</button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue';
import { audioClips, pronunciationLabel } from '../utils/englishAudio';
const props = defineProps({ groups: { type: Array, default: () => [] }, fallback: { type: Array, default: () => [] } });
defineEmits(['play']);
const displayed = computed(() => props.groups.length ? props.groups.map(group => ({ ...group, clips: audioClips(group.audio_refs) }))
  : [{ id: 'fallback', clips: props.fallback }]);
</script>
