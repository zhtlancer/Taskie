<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col">
    <ParentNavBar />
    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <header class="mb-5">
        <h1 class="text-2xl font-black">{{ mode === 'recurring' ? '周期作业' : '字词学习计划' }}</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ mode === 'recurring' ? '按周安排独立作业，内容可以后补，每一期分别记录完成情况。' : '从孩子的字词本安排认读、书写和间隔复习。' }}</p>
      </header>
      <p v-if="loading" role="status">正在读取孩子档案…</p>
      <p v-else-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }} <button type="button" class="min-h-11 px-3 underline" @click="load">重新读取</button></p>
      <ParentChildPicker v-else :children="children" :model-value="selectedChild" :disabled="busy" @change="changeChild" />
      <ParentSectionNav section="learning" :child-id="selectedChild?.id" />
      <template v-if="selectedChild && !loading && !error">
        <div class="mb-4 flex flex-wrap gap-3 text-sm font-bold text-brand-600 dark:text-brand-300">
          <router-link :to="`/child/${selectedChild.id}/${mode === 'recurring' ? 'homework' : 'word-study'}`" class="inline-flex items-center min-h-11">{{ mode === 'recurring' ? '查看作业本 →' : '查看今日字词学习 →' }}</router-link>
        </div>
        <RecurringHomeworkPanel v-if="mode === 'recurring'" :key="selectedChild.id" :child-id="selectedChild.id" :today="calendar.today" @busy="busy = $event" />
        <WordStudyPlanSettings v-else :key="selectedChild.id" :child-id="selectedChild.id" @busy="busy = $event" />
      </template>
    </main>
  </div>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentChildPicker from '../components/ParentChildPicker.vue';
import ParentSectionNav from '../components/ParentSectionNav.vue';
import RecurringHomeworkPanel from '../components/RecurringHomeworkPanel.vue';
import WordStudyPlanSettings from '../components/WordStudyPlanSettings.vue';
import { useParentChildSelection } from '../composables/useParentChildSelection';
import { useCalendarStore } from '../stores/calendar';
import api from '../api/client';
const props = defineProps({ mode: { type: String, required: true } });
const calendar = useCalendarStore();
const children = ref([]), selectedChild = ref(null), loading = ref(true), error = ref(''), busy = ref(false);
const { initialChild, changeChild } = useParentChildSelection(children, selectedChild, child => { selectedChild.value = child; });
let alive = true;
async function load() {
  loading.value = true; busy.value = false; error.value = '';
  try { const result = await api.getChildren(); if (alive) { children.value = result; selectedChild.value = initialChild(); } }
  catch (err) { if (alive) error.value = err.message || String(err); }
  finally { if (alive) loading.value = false; }
}
watch(() => props.mode, () => { busy.value = false; });
onMounted(() => { load(); window.addEventListener('taskie:data-restored', load); });
onBeforeUnmount(() => { alive = false; window.removeEventListener('taskie:data-restored', load); });
</script>
