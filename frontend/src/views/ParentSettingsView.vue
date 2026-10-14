<template>
  <div class="min-h-screen bg-[#F4F6FB]">
    <ParentNavBar />
    <main class="max-w-4xl mx-auto p-6 space-y-6">
      <h2 class="text-2xl font-bold">数据备份与账号设置</h2>
      <p v-if="message" role="status" class="p-4 rounded-xl bg-emerald-50 text-emerald-800">{{ message }}</p>
      <section class="bg-white rounded-2xl p-6 space-y-4">
        <h3 class="text-lg font-bold">备份学习记录和照片</h3>
        <p class="text-sm text-slate-600">{{ info.interval_hours > 0 ? `每 ${info.interval_hours} 小时自动备份，保留最近 ${info.retention} 份。` : '自动备份已关闭。' }} 备份包包含账号、任务、积分、生字和错题照片，请妥善保管。</p>
        <p v-if="info.last_error" class="text-rose-700">最近自动备份失败：{{ info.last_error }}</p>
        <button :disabled="busy" @click="createBackup" class="px-5 py-3 bg-brand-500 text-white rounded-xl disabled:opacity-50">{{ busy ? '处理中…' : '立即创建备份' }}</button>
        <p v-if="!info.backups.length" class="text-slate-500">暂无备份</p>
        <ul class="divide-y">
          <li v-for="item in info.backups" :key="item.name" class="py-3 flex items-center justify-between gap-4">
            <span>{{ new Date(item.created_at).toLocaleString('zh-CN') }} · {{ (item.size / 1048576).toFixed(1) }} MiB</span>
            <button :disabled="busy" @click="download(item)" class="text-brand-600 font-bold">下载备份</button>
          </li>
        </ul>
      </section>
      <section class="bg-white rounded-2xl p-6 space-y-4">
        <h3 class="text-lg font-bold">从备份恢复</h3>
        <p class="text-sm text-slate-600">恢复会替换当前学习记录和照片。系统会先保存当前数据的恢复前备份；完成后需要重新登录。上传文件最大 64 MiB，解压后最大 256 MiB。</p>
        <form @submit.prevent="restore" class="space-y-4">
          <label class="block">备份文件 <input type="file" accept=".gz" required @change="file = $event.target.files[0]" class="block mt-2" /></label>
          <label class="block">当前家长 PIN <input v-model="restorePin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required class="block border rounded-xl p-3 mt-2" autocomplete="current-password" /></label>
          <label class="flex items-center gap-2"><input v-model="confirmed" type="checkbox" required /> 我确认用备份替换当前数据</label>
          <button :disabled="busy || !file || !confirmed" class="px-5 py-3 bg-rose-600 text-white rounded-xl disabled:opacity-50">确认恢复</button>
        </form>
      </section>
      <section class="bg-white rounded-2xl p-6 space-y-4">
        <h3 class="text-lg font-bold">修改家长 PIN</h3>
        <form @submit.prevent="changePin" class="flex flex-wrap gap-3 items-end">
          <label>当前 PIN<input v-model="oldPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="current-password" class="block border rounded-xl p-3 mt-2" /></label>
          <label>新 PIN<input v-model="newPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="new-password" class="block border rounded-xl p-3 mt-2" /></label>
          <button :disabled="busy" class="px-5 py-3 bg-brand-500 text-white rounded-xl disabled:opacity-50">保存 PIN</button>
        </form>
      </section>
    </main>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client';
import { clearTokens } from '../utils/session.js';
import ParentNavBar from '../components/ParentNavBar.vue';
const router = useRouter();
const info = ref({ backups: [], interval_hours: 0, retention: 7 });
const busy = ref(false), message = ref(''), file = ref(null), restorePin = ref(''), confirmed = ref(false), oldPin = ref(''), newPin = ref('');
async function load() { info.value = await api.getBackups(); }
async function run(action) {
  busy.value = true; message.value = '';
  try { await action(); } catch (error) { message.value = String(error); } finally { busy.value = false; }
}
function createBackup() { return run(async () => { await api.createBackup(); await load(); message.value = '备份已保存，可以下载到另一台设备。'; }); }
function download(item) { return run(async () => {
  const blob = await api.downloadBackup(item.name), url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = item.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}); }
function restore() { return run(async () => { await api.restoreBackup(file.value, restorePin.value); clearTokens(); sessionStorage.removeItem('current_child'); await router.replace('/parent/login'); }); }
function changePin() { return run(async () => { await api.changeParentPin(oldPin.value, newPin.value); clearTokens(); await router.replace('/parent/login'); }); }
onMounted(() => run(load));
</script>
