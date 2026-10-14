<template>
  <div class="min-h-screen bg-[#F4F6FB]">
    <ParentNavBar />
    <main class="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
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
        <h3 class="text-lg font-bold">设备授权</h3>
        <p class="text-sm text-slate-600">新设备第一次打开时会显示 6 位配对码。确认是自己家的设备后，在这里输入配对码并起个名字即可授权；以后这台设备就不用再配对。设备丢失时在下方撤销。</p>
        <form @submit.prevent="approveDevice" class="flex flex-wrap gap-3 items-end">
          <label>配对码<input v-model="pairCode" inputmode="numeric" autocomplete="off" maxlength="7" required placeholder="例如 384921" class="block border rounded-xl p-3 mt-2 w-36 tracking-widest font-bold" /></label>
          <label class="w-full sm:w-auto">设备名称<input v-model="pairLabel" maxlength="30" required placeholder="例如 妈妈的 iPhone" class="block w-full sm:w-64 border rounded-xl p-3 mt-2" /></label>
          <button :disabled="busy" class="px-5 py-3 bg-brand-500 text-white rounded-xl disabled:opacity-50 whitespace-nowrap">授权这台设备</button>
        </form>
        <ul class="divide-y">
          <li v-for="device in devices" :key="device.id" class="py-3 flex items-center justify-between gap-4">
            <span class="min-w-0">
              <span class="font-bold">{{ device.label }}</span>
              <span v-if="device.current" class="ml-2 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-bold">当前设备</span>
              <span class="block text-xs text-slate-400">
                授权于 {{ formatTime(device.created_at) }} · 最近使用 {{ device.last_seen_at ? formatTime(device.last_seen_at) : '暂无' }}
              </span>
            </span>
            <button :disabled="busy" @click="revokeDevice(device)" class="text-rose-600 font-bold whitespace-nowrap">撤销</button>
          </li>
        </ul>
        <div class="rounded-xl bg-slate-50 p-4">
          <h4 class="font-bold text-slate-700">最近的授权记录</h4>
          <p class="text-xs text-slate-400 mt-1">来源 IP 仅供参考，可能经过代理转发。</p>
          <p v-if="!deviceEvents.length" class="text-sm text-slate-400 mt-3">暂无记录</p>
          <ul class="divide-y divide-slate-200 mt-2">
            <li v-for="event in shownEvents" :key="event.id" class="py-2 text-sm">
              <span class="font-bold" :class="isWarning(event) ? 'text-rose-600' : 'text-slate-700'">{{ describeEvent(event) }}</span>
              <span class="block text-xs text-slate-400 break-all" :title="event.user_agent || ''">
                {{ formatTime(event.at) }}<template v-if="describeOrigin(event)"> · {{ describeOrigin(event) }}</template>
              </span>
            </li>
          </ul>
          <button v-if="deviceEvents.length > shownEvents.length" type="button" @click="showAllEvents = true" class="mt-2 text-sm font-bold text-brand-600">
            显示全部 {{ deviceEvents.length }} 条
          </button>
        </div>
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
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client';
import { clearTokens } from '../utils/session.js';
import ParentNavBar from '../components/ParentNavBar.vue';
import { describeEvent, describeOrigin, isWarning } from '../utils/deviceEvents.js';
const router = useRouter();
const info = ref({ backups: [], interval_hours: 0, retention: 7 });
const busy = ref(false), message = ref(''), file = ref(null), restorePin = ref(''), confirmed = ref(false), oldPin = ref(''), newPin = ref('');
const devices = ref([]), pairCode = ref(''), pairLabel = ref(''), deviceEvents = ref([]), showAllEvents = ref(false);
const shownEvents = computed(() => (showAllEvents.value ? deviceEvents.value : deviceEvents.value.slice(0, 10)));
async function load() { [info.value, devices.value, deviceEvents.value] = await Promise.all([api.getBackups(), api.getDevices(), api.getDeviceEvents()]); }
async function loadDevices() { [devices.value, deviceEvents.value] = await Promise.all([api.getDevices(), api.getDeviceEvents()]); }
const formatTime = time => (time ? new Date(time).toLocaleString('zh-CN') : '未知');
function approveDevice() { return run(async () => {
  const device = await api.approveDevice(pairCode.value, pairLabel.value);
  pairCode.value = ''; pairLabel.value = '';
  await loadDevices();
  message.value = `已授权「${device.label}」，新设备页面会自动进入应用。`;
}); }
function revokeDevice(device) {
  const warning = device.current ? '这是你正在使用的设备，撤销后需要重新配对。' : '撤销后这台设备将无法打开应用，需要重新配对。';
  if (!confirm(`确定撤销「${device.label}」吗？${warning}`)) return;
  return run(async () => { await api.revokeDevice(device.id); await loadDevices(); message.value = `已撤销「${device.label}」。`; });
}
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
