<template>
  <StudySessionsModal :record-id="recordId" :as-parent="asParent" @close="$emit('close')" @saved="$emit('saved')" />
</template>
<script setup>
import StudySessionsModal from './StudySessionsModal.vue';
defineProps({ recordId: { type: String, required: true }, asParent: Boolean });
defineEmits(['close', 'saved']);
</script>
