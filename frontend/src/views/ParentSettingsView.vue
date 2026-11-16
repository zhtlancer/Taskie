<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950">
    <ParentNavBar />
    <main class="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <ParentPageHeader title="备份与设置" description="管理学习记录备份、设备授权和家长账号。" />
      <ParentSectionNav section="management" />
      <section data-settings-section="backups" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">备份学习记录</h3>
        <ParentPageState v-if="infoState.loading" kind="loading" title="正在读取备份状态…" />
        <ParentPageState v-if="infoState.error" kind="error" title="备份状态未能读取" :description="infoState.error" :busy="busy || infoState.loading" @retry="loadInfo" />
        <SettingsActionNotice :notice="notices.backups" />
        <template v-if="info">
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ info.interval_hours > 0 ? `每 ${info.interval_hours} 小时自动备份，保留最近 ${info.retention} 份。` : '自动备份已关闭。' }} 备份包包含账号、任务、积分、生字等全部记录，体积很小；错题照片不在其中，见下方「错题照片」。请妥善保管。</p>
        <p v-if="info.last_error" role="alert" class="text-rose-700 dark:text-rose-300">最近自动备份失败：{{ info.last_error }}</p>
        <p v-if="info.last_warning" class="text-amber-700 dark:text-amber-300">最近备份已完成，但{{ info.last_warning }}</p>
        </template>
        <button type="button" :disabled="busy || infoState.loading" @click="createBackup" class="ui-button-primary">{{ activeOperation === 'backup' ? '正在创建备份…' : '立即创建备份' }}</button>
        <ParentPageState v-if="info && !infoState.loading && !infoState.error && !info.backups.length" title="暂无备份" description="创建一份学习记录备份，保存后可下载。" />
        <ul class="divide-y divide-slate-200 dark:divide-slate-700">
          <li v-for="item in info?.backups || []" :key="item.name" class="py-3 flex flex-wrap items-center justify-between gap-3">
            <span class="min-w-0 break-words">{{ formatTime(item.created_at) }} · {{ backupSize(item.size) }}<span class="block text-xs text-slate-500 dark:text-slate-400 break-all">{{ item.name }}</span></span>
            <button type="button" :disabled="busy || infoState.loading || Boolean(infoState.error)" @click="download(item)" class="min-h-11 min-w-11 px-3 text-brand-600 dark:text-brand-300 font-bold disabled:opacity-50">下载备份</button>
          </li>
        </ul>
      </section>
      <section data-settings-section="photos" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">错题照片</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300">照片拍好后不会再改，每张只在 NAS 的备份目录里保存一份，不随每天的备份重复复制。照片包（.tar，常见解压软件都能打开）包含当前错题和服务器保留备份引用的照片；新照片指其中尚未完整导出的照片。</p>
        <p class="text-sm text-slate-600 dark:text-slate-300">导出记录是全家共用的，不区分设备。浏览器收到照片包但没有保存成功，系统检测不到，所以下载全部照片始终是最保险的做法。</p>
        <ParentPageState v-if="infoState.loading" kind="loading" title="正在读取照片状态…" />
        <ParentPageState v-if="infoState.error" kind="error" title="照片状态未能读取" :description="infoState.error" :busy="busy || infoState.loading" @retry="loadInfo" />
        <SettingsActionNotice :notice="notices.photos" />
        <div v-if="info?.photo_export" role="status" class="text-sm text-slate-700 dark:text-slate-200 space-y-1">
          <p>{{ info.photo_export.last_complete_at ? `上次完整导出：${formatTime(info.photo_export.last_complete_at)}` : '尚未完整导出照片' }}</p>
          <p>{{ info.photo_export.unreadable_backups?.length ? '已读取的清单中还有' : '还有' }} {{ info.photo_export.pending_count }} 张未导出</p>
        </div>
        <p v-if="info?.photo_export?.unreadable_backups?.length" role="alert" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-4 text-amber-800 dark:text-amber-200">
          有 {{ info.photo_export.unreadable_backups.length }} 份备份清单无法读取，导出统计不完整。仍可上传照片包修复其他照片，但无法确认这些备份独有的照片是否齐全。请保留原备份和照片包，检查损坏的备份后再导出。
        </p>
        <div class="flex flex-wrap gap-3">
          <button type="button" :disabled="busy" @click="downloadPhotos('all')" class="ui-button-secondary">下载全部照片</button>
          <button type="button" :disabled="busy" @click="downloadPhotos('new')" class="ui-button-primary">下载新照片</button>
          <button type="button" :disabled="busy || infoState.loading" @click="loadInfo" class="min-h-11 min-w-11 px-3 font-bold text-brand-600 dark:text-brand-300 disabled:opacity-50">刷新导出状态</button>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">下载完成后可刷新导出状态；回到本页面时也会自动刷新。</p>
        <div v-if="skippedPhotos.length" role="alert" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3 text-amber-800 dark:text-amber-200">
          <p class="font-bold">本次导出跳过 {{ skippedPhotos.length }} 张照片，其余 {{ includedPhotos }} 张已请求下载。被跳过的照片不会记为已导出。</p>
          <ul class="space-y-2 text-sm">
            <li v-for="photo in skippedPhotos" :key="`${photo.name}-${photo.subject}-${photo.description}`" class="break-words">
              {{ photo.subject || '未知科目' }} · {{ photo.created_at ? businessDate(photo.created_at, timeZone) : '未知日期' }} · {{ photo.description || '未填写题目' }}
              <span class="font-bold">（{{ photo.reason === 'mismatch' ? '校验不一致' : '不存在' }}）</span>
            </li>
          </ul>
          <p class="text-sm">请上传当时下载的正确照片包，补齐或修复这些照片后再导出。</p>
        </div>
        <div v-if="info?.missing_photos?.count" role="alert" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3 text-amber-800 dark:text-amber-200">
            <p class="font-bold">有 {{ info.missing_photos.count }} 张错题照片需要补齐：不存在 {{ info.missing_photos.absent }} 张，校验不一致 {{ info.missing_photos.mismatch }} 张。</p>
            <ul class="space-y-3 text-sm">
              <li v-for="photo in info.missing_photos.sample" :key="photo.name" class="break-words">
                <p class="font-bold">{{ photo.subject || '未填写科目' }} · {{ photo.created_at ? businessDate(photo.created_at, timeZone) : '日期未知' }}</p>
                <p class="whitespace-pre-wrap">{{ photo.description || '未填写题目描述' }}</p>
                <p>{{ photo.reason === 'mismatch' ? '校验不一致' : '不存在' }}</p>
              </li>
            </ul>
            <p v-if="info.missing_photos.count > info.missing_photos.sample.length" class="text-sm">这里只显示前 {{ info.missing_photos.sample.length }} 张，还有 {{ info.missing_photos.count - info.missing_photos.sample.length }} 张需要补齐。</p>
            <p class="text-sm">从别的服务器恢复备份后可能缺少照片；校验不一致表示内容与备份清单不符。请上传当时下载的正确照片包，系统会核对内容并补齐或修复照片，已有且校验正确的照片会保留。可以多次上传、上传多个照片包。</p>
        </div>
          <form @submit.prevent="importPhotos">
            <fieldset :disabled="busy" class="min-w-0 flex flex-wrap items-end gap-3">
            <label class="block min-w-0 max-w-full text-sm">照片包 <input ref="photoInput" type="file" accept=".tar,application/x-tar" required @change="photoFile = $event.target.files[0]" class="block mt-2 min-h-11 w-full min-w-0 max-w-full" /></label>
            <button :disabled="busy || !photoFile" class="min-h-11 min-w-11 px-5 py-3 bg-amber-600 text-white rounded-xl font-bold disabled:opacity-50">上传照片包</button>
            </fieldset>
          </form>
          <div v-if="uploading" role="status" class="text-sm space-y-2">
            <p>{{ uploadPercent === null ? '正在上传照片包…' : uploadPercent < 100 ? `正在上传照片包 ${uploadPercent}%` : '上传完成，正在核对并补齐照片…' }}</p>
            <progress aria-label="照片包上传进度" :value="uploadPercent ?? undefined" max="100" class="block w-full h-3 accent-amber-600"></progress>
          </div>
      </section>
      <section data-settings-section="restore" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">从备份恢复</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300">恢复会替换当前学习记录和照片。系统会先保存当前数据的恢复前备份；完成后需要重新登录。照片从本机保存的照片中取回；在新服务器上恢复时，照片需要再上传照片包补齐（恢复后会在上方提示）。旧版本带照片的备份也可以直接恢复。</p>
        <SettingsActionNotice :notice="notices.restore" />
        <form @submit.prevent="restore">
          <fieldset :disabled="busy" class="min-w-0 space-y-4">
          <label class="block min-w-0">备份文件 <input type="file" accept=".gz" required @change="file = $event.target.files[0]" class="block mt-2 min-h-11 w-full min-w-0 max-w-full" /></label>
          <label class="block">当前家长 PIN <input v-model="restorePin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required class="block border rounded-xl p-3 mt-2 min-h-11 w-full sm:max-w-xs" autocomplete="current-password" /></label>
          <label class="flex min-h-11 items-center gap-2"><input v-model="confirmed" type="checkbox" required /> 我确认用备份替换当前数据</label>
          <button :disabled="busy || !file || !confirmed" class="min-h-11 min-w-11 px-5 py-3 bg-rose-600 text-white rounded-xl disabled:opacity-50">{{ activeOperation === 'restore' ? '正在恢复…' : '确认恢复' }}</button>
          </fieldset>
        </form>
      </section>
      <section data-settings-section="devices" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">设备授权</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300">新设备第一次打开时会显示 6 位配对码。确认是自己家的设备后，在这里输入配对码并起个名字即可授权；以后这台设备就不用再配对。设备丢失时在下方撤销。</p>
        <ParentPageState v-if="devicesState.loading" kind="loading" title="正在读取授权设备…" />
        <ParentPageState v-if="devicesState.error" kind="error" title="授权设备未能读取" :description="devicesState.error" :busy="busy || devicesState.loading" @retry="loadDevices" />
        <SettingsActionNotice :notice="notices.devices" />
        <form @submit.prevent="approveDevice">
          <fieldset :disabled="busy" class="min-w-0 flex flex-wrap gap-3 items-end">
          <label>配对码<input v-model="pairCode" inputmode="numeric" autocomplete="off" maxlength="7" required placeholder="例如 384921" class="block border rounded-xl p-3 mt-2 w-36 tracking-widest font-bold" /></label>
          <label class="w-full sm:w-auto">设备名称<input v-model="pairLabel" maxlength="30" required placeholder="例如 妈妈的 iPhone" class="block w-full sm:w-64 border rounded-xl p-3 mt-2" /></label>
          <button :disabled="busy" class="ui-button-primary">{{ activeOperation === 'approve' ? '正在授权…' : '授权这台设备' }}</button>
          </fieldset>
        </form>
        <ParentPageState v-if="devicesState.ready && !devicesState.error && !devicesState.loading && !devices.length" title="暂无授权设备" />
        <ul class="divide-y divide-slate-200 dark:divide-slate-700">
          <li v-for="device in devices" :key="device.id" class="py-3 flex items-center justify-between gap-3">
            <span class="min-w-0">
              <span class="font-bold break-words">{{ device.label }}</span>
              <span v-if="device.current" class="ml-2 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">当前设备</span>
              <span class="block text-xs text-slate-400">
                授权于 {{ formatTime(device.created_at) }} · 最近使用 {{ device.last_seen_at ? formatTime(device.last_seen_at) : '暂无' }}
              </span>
            </span>
            <button type="button" :disabled="busy || devicesState.loading || Boolean(devicesState.error)" @click="revokeDevice(device)" class="min-h-11 min-w-11 px-3 shrink-0 text-rose-600 dark:text-rose-300 font-bold disabled:opacity-50">撤销</button>
          </li>
        </ul>
        <div class="rounded-xl bg-slate-50 dark:bg-slate-800 p-4">
          <h4 class="font-bold text-slate-700 dark:text-slate-200">最近的授权记录</h4>
          <p class="text-xs text-slate-400 mt-1">来源 IP 仅供参考，可能经过代理转发。</p>
          <ParentPageState v-if="eventsState.loading" kind="loading" title="正在读取授权记录…" />
          <ParentPageState v-if="eventsState.error" kind="error" title="授权记录未能读取" :description="eventsState.error" :busy="busy || eventsState.loading" @retry="loadEvents" />
          <ParentPageState v-if="eventsState.ready && !eventsState.error && !eventsState.loading && !deviceEvents.length" title="暂无记录" />
          <ul class="divide-y divide-slate-200 dark:divide-slate-700 mt-2">
            <li v-for="event in shownEvents" :key="event.id" class="py-2 text-sm">
              <span class="font-bold" :class="isWarning(event) ? 'text-rose-600 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'">{{ describeEvent(event) }}</span>
              <span class="block text-xs text-slate-400 break-all" :title="event.user_agent || ''">
                {{ formatTime(event.at) }}<template v-if="describeOrigin(event)"> · {{ describeOrigin(event) }}</template>
              </span>
            </li>
          </ul>
          <button v-if="deviceEvents.length > shownEvents.length" type="button" :disabled="busy" @click="showAllEvents = true" class="mt-2 min-h-11 min-w-11 text-sm font-bold text-brand-600 dark:text-brand-300 disabled:opacity-50">
            显示全部 {{ deviceEvents.length }} 条
          </button>
        </div>
      </section>
      <section data-settings-section="drafts" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">本机表单草稿</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300">草稿只保存在当前浏览器，最多保留 100 份、7 天。清理前请先核对尚未确认的保存操作；已保存到服务器的记录和其他设备的草稿不受影响。</p>
        <SettingsActionNotice :notice="notices.drafts" />
        <button type="button" :disabled="busy" class="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold disabled:opacity-40" @click="clearFormDrafts">清除本机全部草稿</button>
      </section>
      <section data-settings-section="pin" class="settings-section bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 space-y-4">
        <h3 class="text-lg font-bold">修改家长 PIN</h3>
        <SettingsActionNotice :notice="notices.pin" />
        <form @submit.prevent="changePin">
          <fieldset :disabled="busy" class="min-w-0 flex flex-wrap gap-3 items-end">
          <label class="min-w-0 w-full sm:w-auto">当前 PIN<input v-model="oldPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="current-password" class="block border rounded-xl p-3 mt-2 min-h-11 w-full" /></label>
          <label class="min-w-0 w-full sm:w-auto">新 PIN<input v-model="newPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="new-password" class="block border rounded-xl p-3 mt-2 min-h-11 w-full" /></label>
          <button :disabled="busy" class="ui-button-primary">{{ activeOperation === 'pin' ? '正在保存…' : '保存 PIN' }}</button>
          </fieldset>
        </form>
      </section>
    </main>
  </div>
</template>
<script setup>
import { useCalendarStore } from '../stores/calendar';
import { confirmAction } from '../utils/confirmation';
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import api from '../api/client';
import { clearTokens, endSession, getToken, hasSession } from '../utils/session.js';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentPageHeader from '../components/ParentPageHeader.vue';
import ParentPageState from '../components/ParentPageState.vue';
import SettingsActionNotice from '../components/SettingsActionNotice.vue';
import ParentSectionNav from '../components/ParentSectionNav.vue';
import { describeEvent, describeOrigin, isWarning } from '../utils/deviceEvents.js';
import { businessDate } from '../utils/businessDate.js';
import { localFormDrafts } from '../utils/formDrafts.js';
const calendar = useCalendarStore();
const router = useRouter();
const info = ref(null);
const activeOperation = ref(''), busy = computed(() => Boolean(activeOperation.value));
const file = ref(null), restorePin = ref(''), confirmed = ref(false), oldPin = ref(''), newPin = ref('');
const uploading = ref(false), uploadPercent = ref(null), photoInput = ref(null);
const notices = reactive(Object.fromEntries(['backups', 'photos', 'restore', 'devices', 'drafts', 'pin'].map(key => [key, { message: '', failed: false }])));
const readingState = () => reactive({ loading: true, ready: false, error: '' });
const infoState = readingState(), devicesState = readingState(), eventsState = readingState();
let alive = true, actionSerial = 0;
onBeforeRouteLeave(to => !hasSession('parent') || ['/parent/login', '/parent/setup-pin'].includes(to.path) || !busy.value);
onBeforeRouteUpdate(() => { if (busy.value) return false; });
const errorText = error => typeof error === 'string' ? error : error.message || '操作失败，请重试';

// Each section owns its requests. Old reads cannot replace a newer snapshot or a new login.
function reader(state, fetch, apply) {
  let serial = 0;
  return async () => {
    const request = ++serial, owner = getToken('parent');
    const current = () => alive && request === serial && getToken('parent') === owner;
    state.loading = true; state.error = '';
    try {
      const value = await fetch();
      if (current()) { apply(value); state.ready = true; return true; }
    } catch (error) { if (current()) state.error = errorText(error); }
    finally { if (current()) state.loading = false; }
    return false;
  };
}
const loadInfo = reader(infoState, () => api.getBackups(), value => { info.value = value; });
const loadDevices = reader(devicesState, () => api.getDevices(), value => { devices.value = value; });
const loadEvents = reader(eventsState, () => api.getDeviceEvents(), value => { deviceEvents.value = value; });
const backupSize = size => size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MiB`;
async function clearFormDrafts() {
  if (busy.value) return;
  if (!await confirmAction('确定清除当前浏览器中所有角色和孩子的草稿吗？尚未确认的操作可能已保存，请先核对记录。')) return;
  if (!alive) return;
  return run('drafts', 'drafts', async () => { localFormDrafts.clearAll(); return '本机草稿已清除，已保存记录保持不变。'; });
}
// Remove the old device-clock marker; export history now belongs to the server.
try { localStorage.removeItem('taskie_photo_export_at'); } catch { /* An obsolete marker must not prevent opening settings. */ }
const skippedPhotos = ref([]), includedPhotos = ref(0);
const photoFile = ref(null), timeZone = computed(() => calendar.timeZone);
const devices = ref([]), pairCode = ref(''), pairLabel = ref(''), deviceEvents = ref([]), showAllEvents = ref(false);
const shownEvents = computed(() => (showAllEvents.value ? deviceEvents.value : deviceEvents.value.slice(0, 10)));
function refreshPhotoStatus() {
  if (!busy.value && !infoState.loading && document.visibilityState === 'visible') loadInfo();
}
const refreshDevices = () => Promise.allSettled([loadDevices(), loadEvents()]);
const formatTime = time => (time ? new Date(time).toLocaleString('zh-CN', { timeZone: calendar.timeZone, hour12: false }) : '未知');
function approveDevice() {
  if (!pairCode.value.trim() || !pairLabel.value.trim()) return;
  const code = pairCode.value, label = pairLabel.value;
  return run('devices', 'approve', async () => {
    const device = await api.approveDevice(code, label);
    pairCode.value = ''; pairLabel.value = '';
    return `已授权「${device.label}」，新设备页面会自动进入应用。`;
  }, refreshDevices);
}
async function revokeDevice(device) {
  if (busy.value || devicesState.loading || devicesState.error) return;
  const warning = device.current ? '这是你正在使用的设备，撤销后需要重新配对。' : '撤销后这台设备将无法打开应用，需要重新配对。';
  if (!await confirmAction(`确定撤销「${device.label}」吗？${warning}`)) return;
  if (!alive || devicesState.loading || devicesState.error) return;
  return run('devices', 'revoke', async () => {
    await api.revokeDevice(device.id);
    devices.value = devices.value.filter(item => item.id !== device.id);
    return `已撤销「${device.label}」。`;
  }, refreshDevices);
}
async function run(section, operation, action, refresh) {
  if (busy.value || !alive) return false;
  const serial = ++actionSerial, owner = getToken('parent');
  const current = () => alive && serial === actionSerial && getToken('parent') === owner;
  activeOperation.value = operation;
  notices[section] = { message: '', failed: false };
  let saved = false;
  try {
    const message = await action(current);
    saved = true;
    if (current()) notices[section] = { message: message || '', failed: false };
  } catch (error) { if (current()) notices[section] = { message: errorText(error), failed: true }; }
  finally { if (serial === actionSerial) activeOperation.value = ''; }
  // Refreshes have their own failure state and must not turn an accepted write into a failed save.
  if (saved && current()) refresh?.();
  return saved;
}
function createBackup() {
  if (infoState.loading) return false;
  return run('backups', 'backup', async () => { await api.createBackup(); return '备份已保存，可以下载到另一台设备。'; }, loadInfo);
}
function download(item) {
  if (infoState.loading || infoState.error) return false;
  return run('backups', 'download', async () => {
    const blob = await api.downloadBackup(item.name), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = item.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
// Native downloads do not report completion to the page. Only server responses update the status.
function downloadPhotos(scope) { return run('photos', 'export', async () => {
  const { url, included_count, skipped = [] } = await api.photoPackageTicket(scope);
  skippedPhotos.value = skipped; includedPhotos.value = included_count ?? 0;
  const link = document.createElement('a'); link.href = url; link.download = ''; link.click();
  return `${scope === 'new' ? '新照片' : '全部照片'}的照片包已请求下载，照片多时需要一些时间。请确认浏览器下载并保存成功后，刷新导出状态。`;
}); }
function importPhotos() {
  if (!photoFile.value) return;
  const selected = photoFile.value;
  return run('photos', 'import', async () => {
    uploading.value = true; uploadPercent.value = null;
    let result;
    try {
      result = await api.importPhotos(selected, event => {
        uploadPercent.value = event.total ? Math.min(100, Math.floor(event.loaded * 100 / event.total)) : null;
      });
    } finally { uploading.value = false; }
    photoFile.value = null;
    if (photoInput.value) photoInput.value.value = '';
    return `已补齐或修复 ${result.imported} 张照片${result.present ? `，${result.present} 张原本就在` : ''}${result.unused ? `，${result.unused} 张已不需要` : ''}${result.mismatch ? `，${result.mismatch} 张与清单不符，未安装` : ''}${result.unverified ? `，${result.unverified} 张没有可信校验信息，请用包含原照片的备份恢复或重新上传错题照片` : ''}。${result.missing ? `还缺 ${result.missing} 张。` : result.unreadable_backups?.length ? '' : '照片已全部齐全。'}${result.unreadable_backups?.length ? `有 ${result.unreadable_backups.length} 份备份清单无法读取，无法确认所有照片是否齐全。` : ''}`;
  }, loadInfo);
}
function restore() {
  if (!file.value || !confirmed.value || !/^[0-9]{4}$/.test(restorePin.value)) return;
  const selected = file.value, pin = restorePin.value;
  return run('restore', 'restore', async current => {
    await api.restoreBackup(selected, pin);
    if (!current()) return;
    endSession(); sessionStorage.removeItem('current_child'); await router.replace('/parent/login');
  });
}
function changePin() {
  if (!/^[0-9]{4}$/.test(oldPin.value) || !/^[0-9]{4}$/.test(newPin.value)) return;
  const previous = oldPin.value, next = newPin.value;
  return run('pin', 'pin', async current => {
    await api.changeParentPin(previous, next);
    if (!current()) return;
    clearTokens(); await router.replace('/parent/login');
  });
}
onMounted(() => {
  loadInfo(); loadDevices(); loadEvents();
  window.addEventListener('focus', refreshPhotoStatus);
  document.addEventListener('visibilitychange', refreshPhotoStatus);
});
onBeforeUnmount(() => {
  alive = false; actionSerial++;
  window.removeEventListener('focus', refreshPhotoStatus);
  document.removeEventListener('visibilitychange', refreshPhotoStatus);
});
</script>

<style scoped>
.settings-section { min-width: 0; }
.settings-section :deep(label) { min-width: 0; }
</style>
