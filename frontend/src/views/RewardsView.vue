<template>
  <div data-rewards-page class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto">
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
        <div class="min-w-0 flex-1 basis-52">
          <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100">🏆 积分与荣耀徽章</h1>
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">每一次坚持都在闪闪发光</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <SoundToggle />
          <router-link :to="`/child/${childId}/today`" @click="playClick" class="hidden lg:inline-flex min-h-11 items-center px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button hover:bg-brand-600">返回今日看板</router-link>
        </div>
      </header>

      <PageState v-if="!calendar.ready" kind="loading" title="等待确认家庭日期…" description="请先通过页面顶部的提示重新读取家庭时区，再查看积分与兑换奖励。" />
      <template v-else>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4" aria-label="积分概览">
          <div data-rewards-balance class="col-span-2 sm:col-span-1 rounded-2xl p-4 sm:p-5 bg-amber-300 text-amber-950 min-w-0">
            <p class="text-xs font-bold">当前积分余额</p>
            <p class="text-3xl font-black mt-1 break-words">{{ totalPoints ?? '—' }} <span class="text-sm">分</span></p>
            <p class="text-xs mt-1">{{ stats.state.loading ? '正在更新余额…' : stats.state.error ? '余额待更新' : '已扣除待确认和已兑换的积分' }}</p>
          </div>
          <div class="rounded-2xl p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 min-w-0">
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">连续坚持</p>
            <p class="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{{ stats.fresh.value ? stats.state.data.current_streak : '—' }} <span class="text-sm">天</span></p>
          </div>
          <div class="rounded-2xl p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 min-w-0">
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">已解锁成就</p>
            <p class="text-2xl font-black text-brand-700 dark:text-brand-300 mt-1">{{ badges.fresh.value ? `${unlockedCount} / ${badges.state.data.length}` : '—' }}</p>
          </div>
        </div>
        <PageState v-if="stats.state.loading" kind="loading" title="正在读取积分概览…" />
        <PageState v-if="stats.state.error" kind="error" title="积分概览未能读取" :description="stats.state.error" :busy="busy" @retry="stats.load()" />
        <p v-if="notice" role="status" class="mb-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm font-bold text-emerald-800 dark:text-emerald-200">{{ notice }}</p>

        <section aria-labelledby="shop-title" class="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700 mb-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 id="shop-title" class="text-lg font-black text-slate-800 dark:text-slate-100">🎁 积分兑换商城</h2>
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">兑换后等爸爸妈妈确认哦</p>
          </div>
          <p v-if="pendingEntries.length" role="status" class="mb-3 text-sm font-bold text-amber-800 dark:text-amber-200">有兑换尚未确认，请先在页面下方的“待确认请求”核对原操作。</p>
          <p v-else-if="!canRedeem && !busy" class="mb-3 text-xs text-slate-500 dark:text-slate-400">积分余额、奖励和兑换记录读取成功后即可兑换。</p>
          <PageState v-if="items.state.loading" kind="loading" title="正在读取奖励…" />
          <PageState v-if="items.state.error" kind="error" title="奖励未能读取" :description="items.state.error" :busy="busy" @retry="items.load()" />
          <PageState v-if="items.fresh.value && !items.state.data.length" title="还没有上架的奖励" description="请爸爸妈妈在家长后台添加奖励。" />
          <div v-if="items.state.data?.length" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <article v-for="item in items.state.data" :key="item.id" :data-reward-item="item.id" class="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 sm:p-4 flex flex-col items-center text-center">
              <span class="text-3xl mb-2" aria-hidden="true">{{ item.icon_emoji }}</span>
              <h3 class="w-full text-sm font-bold text-slate-800 dark:text-slate-100 break-words [overflow-wrap:anywhere]">{{ item.title }}</h3>
              <p class="mt-2 mb-3 text-sm font-black text-amber-700 dark:text-amber-300">★ {{ item.cost }} 分</p>
              <button type="button" :disabled="!canRedeem || totalPoints < item.cost" @click="openRedeem(item)" class="mt-auto w-full min-h-11 px-2 py-2 rounded-xl bg-amber-300 text-amber-950 font-black text-sm hover:bg-amber-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:opacity-60">
                {{ totalPoints !== null && totalPoints < item.cost ? `还差 ${item.cost - totalPoints} 分` : '兑换' }}
              </button>
            </article>
          </div>
        </section>

        <section aria-labelledby="redemptions-title" class="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700 mb-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 id="redemptions-title" class="text-lg font-black text-slate-800 dark:text-slate-100">我的兑换记录</h2>
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">全部待确认申请与最近 8 条历史记录</p>
          </div>
          <PageState v-if="redemptions.state.loading" kind="loading" title="正在读取兑换记录…" />
          <PageState v-if="redemptions.state.error" kind="error" title="兑换记录未能读取" :description="redemptions.state.error" :busy="busy" @retry="redemptions.load()" />
          <PageState v-if="redemptions.fresh.value && !redemptions.state.data.length" title="还没有兑换记录" description="攒够积分后，可以选择喜欢的奖励。" />
          <ul v-if="redemptions.state.data?.length" class="space-y-3">
            <li v-for="record in redemptions.state.data" :key="record.id" :data-redemption-record="record.id" class="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <h3 class="min-w-0 flex-1 basis-40 text-sm font-bold text-slate-800 dark:text-slate-100 break-words [overflow-wrap:anywhere]">{{ record.icon_emoji }} {{ record.title }}</h3>
                <span class="shrink-0 px-2 py-1 rounded-lg text-xs font-black" :class="statusInfo[record.status].class">{{ statusInfo[record.status].label }}</span>
              </div>
              <p class="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{{ pointsDescription(record) }}</p>
              <p v-if="record.status === 'refunded'" class="mt-2 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">撤销原因：{{ record.refund_reason }}</p>
              <div v-if="record.status === 'pending'" class="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <button type="button" :disabled="!canCancel" @click="openCancel(record)" class="min-h-11 min-w-11 px-3 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50">撤回</button>
              </div>
            </li>
          </ul>
        </section>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <section aria-labelledby="badges-title" class="xl:col-span-2 min-w-0 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700">
            <h2 id="badges-title" class="text-lg font-black text-slate-800 dark:text-slate-100 mb-4">🎖️ 徽章荣誉墙</h2>
            <PageState v-if="badges.state.loading" kind="loading" title="正在读取徽章…" />
            <PageState v-if="badges.state.error" kind="error" title="徽章未能读取" :description="badges.state.error" :busy="busy" @retry="badges.load()" />
            <PageState v-if="badges.fresh.value && !badges.state.data.length" title="暂时没有徽章" />
            <BadgeWall v-if="badges.state.data?.length" :key="identityKey" :badges="badges.state.data" />
          </section>
          <div class="min-w-0">
            <PageState v-if="logs.state.loading" kind="loading" title="正在读取积分明细…" />
            <PageState v-if="logs.state.error" kind="error" title="积分明细未能读取" :description="logs.state.error" :busy="busy" @retry="logs.load()" />
            <PointsLog v-if="logs.state.data !== null" :logs="logs.state.data" />
          </div>
        </div>
      </template>
    </div>

    <UiDialog v-if="target" :title="target.kind === 'redeem' ? '兑换奖励' : '撤回兑换申请'" :busy="busy" @close="closeDialog">
      <p class="text-base font-bold break-words [overflow-wrap:anywhere]">{{ target.item.icon_emoji }} {{ target.item.title }}</p>
      <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">{{ target.kind === 'redeem' ? `本次需要 ${target.item.cost} 分，提交后等待家长确认。` : `撤回后释放这次申请占用的 ${target.item.cost} 分。` }}</p>
      <p v-if="target.kind === 'redeem' && target.attempt.request_id" class="mt-3 text-sm text-amber-800 dark:text-amber-200">重试会核对原兑换申请，不会再次扣分；也可以关闭后到“待确认请求”继续确认。</p>
      <p v-if="dialogError" role="alert" class="mt-3 text-sm font-bold text-rose-700 dark:text-rose-300">{{ dialogError }}</p>
      <template #footer>
        <button type="button" :disabled="busy" class="ui-button-secondary" @click="closeDialog">取消</button>
        <button type="button" :disabled="!canSubmit" class="ui-button-primary" @click="submit">{{ busy ? '正在确认…' : target.kind === 'cancel' ? '确认撤回' : target.attempt.request_id ? '按原申请重试' : '确定兑换？' }}</button>
      </template>
    </UiDialog>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import api from '../api/client';
import { getPendingRedemptions } from '../api/redemptions';
import { useCalendarStore } from '../stores/calendar';
import { useChildStore } from '../stores/child';
import { currentRole, getToken, getDataGeneration, hasSession } from '../utils/session.js';
import { activeWrites, pendingWriteStore } from '../utils/requestId.js';
import { playClick, playBadgeUnlocked } from '../utils/sound';
import ChildTabBar from '../components/ChildTabBar.vue';
import BadgeWall from '../components/BadgeWall.vue';
import PointsLog from '../components/PointsLog.vue';
import SoundToggle from '../components/SoundToggle.vue';
import PageState from '../components/ParentPageState.vue';
import UiDialog from '../components/UiDialog.vue';
const route = useRoute(), calendar = useCalendarStore(), childStore = useChildStore();
const childId = computed(() => route.params.id);
const scopeKey = computed(() => `${childId.value}|${calendar.today}|${calendar.timeZone}`);
const identityKey = ref(0), busy = ref(false), target = ref(null), dialogError = ref(''), notice = ref(''), revision = ref(0);
let alive = true, epoch = 0, refreshQueued = false;
const silent = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，请检查网络后重新读取。' };
const message = error => typeof error === 'string' ? error : error?.message || '操作失败，请重试。';
const capture = () => ({ child: childId.value, key: scopeKey.value, token: getToken(), epoch, generation: getDataGeneration() });
const current = scope => alive && scope.child === childId.value && scope.token === getToken() && scope.epoch === epoch;

// Each section owns its response, error and cancellation. One failed section cannot hide the rest.
function reader(fetch) {
  const state = reactive({ data: null, loading: false, error: '', key: '' });
  let serial = 0, controller;
  const fresh = computed(() => calendar.ready && state.data !== null && state.key === scopeKey.value && !state.loading && !state.error);
  function stop(clear = false) {
    serial++; controller?.abort(); controller = undefined;
    state.loading = false;
    if (clear) { state.data = null; state.error = ''; state.key = ''; }
  }
  async function load({ afterWrite = false } = {}) {
    if (busy.value && !afterWrite) { refreshQueued = true; return; }
    stop();
    if (!alive || !calendar.ready || !getToken()) return;
    const scope = capture(), request = serial, abort = new AbortController(); controller = abort;
    const matches = () => current(scope) && scope.key === scopeKey.value && calendar.ready && request === serial;
    state.loading = true; state.error = '';
    try {
      const result = await fetch(scope.child, abort.signal);
      if (matches()) { state.data = result; state.key = scope.key; }
    } catch (error) { if (matches() && !abort.signal.aborted) state.error = message(error); }
    finally { if (request === serial) { state.loading = false; controller = undefined; } }
  }
  return { state, fresh, load, stop };
}
const stats = reader((id, signal) => api.getChildStats(id, signal, silent));
const items = reader(async (_id, signal) => (await api.getRewardItems(signal, silent)).filter(item => item.is_active));
const redemptions = reader(async (id, signal) => {
  const [pending, history] = await Promise.all([
    getPendingRedemptions(params => api.getChildRedemptions(id, params, signal, silent)),
    api.getChildRedemptions(id, { status: 'history', limit: 8 }, signal, silent)
  ]);
  return [...pending, ...history];
});
const badges = reader(async (id, signal) => {
  const [definitions, owned] = await Promise.all([api.getBadgeDefinitions(signal, silent), api.getChildBadges(id, signal, silent)]);
  const unlocked = new Map(owned.map(badge => [badge.badge_id || badge.key, badge]));
  return definitions.map(definition => {
    const found = unlocked.get(definition.id) || unlocked.get(definition.key);
    return { ...definition, is_unlocked: Boolean(found), unlocked_at: found?.unlocked_at || null };
  });
});
const logs = reader((id, signal) => api.getPointLogs(id, signal, silent));
const readers = [stats, items, redemptions, badges, logs];
const totalPoints = computed(() => stats.fresh.value ? stats.state.data.available_points : null);
const unlockedCount = computed(() => badges.state.data?.filter(badge => badge.is_unlocked).length || 0);
const pendingEntries = computed(() => {
  revision.value;
  try { return pendingWriteStore.list().filter(entry => entry.kind === 'redemption' && entry.role === currentRole() && entry.child_id === childId.value); }
  catch { return []; } // The write helper refuses to send if storage cannot preserve the original request.
});
const anotherWrite = computed(() => pendingEntries.value.some(entry => activeWrites.has(entry.request_id)));
const canRedeem = computed(() => !busy.value && stats.fresh.value && items.fresh.value && redemptions.fresh.value && !pendingEntries.value.length);
const canCancel = computed(() => !busy.value && !anotherWrite.value && redemptions.fresh.value);
const canSubmit = computed(() => {
  if (!target.value || busy.value || !calendar.ready || !getToken() || anotherWrite.value) return false;
  if (target.value.kind === 'cancel') return canCancel.value && redemptions.state.data.some(record => record.id === target.value.item.id && record.status === 'pending');
  // A lost response may already have reduced the balance. Replay the same id even when it is now too low for a new exchange.
  if (target.value.attempt.request_id) return pendingEntries.value.some(entry => entry.request_id === target.value.attempt.request_id);
  const item = items.state.data?.find(item => item.id === target.value.item.id);
  return canRedeem.value && item && item.cost === target.value.item.cost && item.title === target.value.item.title && totalPoints.value >= item.cost;
});
const statusInfo = {
  pending: { label: '等待确认', class: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200' },
  approved: { label: '已兑换', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' },
  rejected: { label: '未通过', class: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' },
  cancelled: { label: '已撤回', class: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
  refunded: { label: '已撤销退分', class: 'bg-sky-100 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200' }
};
function pointsDescription(record) {
  if (record.status === 'pending') return `占用 ${record.cost} 分 · 家长确认前可以撤回`;
  if (record.status === 'approved') return `已使用 ${record.cost} 分`;
  return `已释放 ${record.cost} 分${record.status === 'refunded' ? ' · 退回原扣积分' : ''}`;
}
function openRedeem(item) {
  if (!canRedeem.value || totalPoints.value < item.cost || target.value) return;
  playClick(); notice.value = ''; dialogError.value = '';
  target.value = { kind: 'redeem', item: { ...item }, attempt: {} };
}
function openCancel(record) {
  if (!canCancel.value || target.value) return;
  playClick(); notice.value = ''; dialogError.value = '';
  target.value = { kind: 'cancel', item: { ...record }, attempt: {} };
}
function closeDialog() { if (!busy.value) { target.value = null; dialogError.value = ''; } }
function reconcileDialog() {
  if (!target.value || busy.value) return;
  if (target.value.kind === 'cancel' && redemptions.fresh.value) {
    const record = redemptions.state.data.find(record => record.id === target.value.item.id);
    if (record?.status === 'pending') return;
    notice.value = record?.status === 'cancelled' ? '兑换申请已撤回，原占用积分已释放。' : '这条兑换申请已处理，请查看最新兑换记录。';
    closeDialog();
  } else if (target.value.kind === 'redeem') {
    if (target.value.attempt.request_id) {
      if (!pendingEntries.value.some(entry => entry.request_id === target.value.attempt.request_id)) { notice.value = '原兑换操作已确认，请查看兑换记录。'; closeDialog(); }
    } else if (items.fresh.value) {
      const item = items.state.data.find(item => item.id === target.value.item.id);
      if (!item || item.title !== target.value.item.title || item.cost !== target.value.item.cost) dialogError.value = '奖励信息已更新，请关闭后重新选择奖励。';
    }
  }
}
async function refresh({ afterWrite = false } = {}) {
  if (busy.value && !afterWrite) { refreshQueued = true; return; }
  await Promise.all(readers.map(resource => resource.load({ afterWrite })));
  reconcileDialog();
}
async function submit() {
  if (!canSubmit.value) return;
  const scope = capture(), dialog = target.value;
  busy.value = true; dialogError.value = ''; notice.value = '';
  readers.forEach(resource => resource.stop());
  try {
    const result = dialog.kind === 'redeem'
      ? await api.requestRedemption(scope.child, dialog.item.id, dialog.item.title, childStore.childId === scope.child ? childStore.childName : '小朋友', dialog.attempt, { silentError: true, preserveError: true, preserveNetworkError: true })
      : await api.cancelRedemption(dialog.item.id, { ...silent, networkErrorMessage: '撤回结果尚未确认，请重新读取兑换记录核对后重试。', headers: scope.generation ? { 'X-Taskie-Data-Generation': scope.generation } : {} });
    if (!current(scope)) return;
    const list = redemptions.state.data || [];
    redemptions.state.data = [result, ...list.filter(record => record.id !== result.id)];
    target.value = null;
    notice.value = dialog.kind === 'cancel' ? '兑换申请已撤回，原占用积分已释放。'
      : result.status === 'pending' ? `兑换申请已提交，已占用 ${result.cost} 分，等待家长确认。` : `原兑换申请${statusInfo[result.status].label}，没有再次扣分。`;
    if (dialog.kind === 'redeem' && result.status === 'pending') playBadgeUnlocked();
  } catch (error) {
    if (current(scope)) {
      dialogError.value = message(error);
      // These business rejections confirm that this id did not create an exchange.
      // Keep network/server failures recoverable, but do not freeze the shop behind a rejected request.
      if (dialog.kind === 'redeem' && [400, 404, 409].includes(error?.status) && error?.code !== 'DATA_RESTORED' && dialog.attempt.request_id) {
        try { pendingWriteStore.discard(dialog.attempt.request_id); dialog.attempt = {}; }
        catch { /* Keep the original request when session storage cannot be updated. */ }
      }
    }
  }
  finally {
    try { if (alive) await refresh({ afterWrite: true }); }
    finally {
      busy.value = false; revision.value++; reconcileDialog();
      if (alive && (refreshQueued || !current(scope))) { refreshQueued = false; refresh(); }
    }
  }
}
function resetScope() {
  epoch++; identityKey.value++; readers.forEach(resource => resource.stop(true));
  target.value = null; dialogError.value = ''; notice.value = ''; revision.value++;
  refresh();
}
function resume() { if (!document.hidden) refresh(); }
function pendingChanged() { revision.value++; }
function confirmed() { revision.value++; refresh(); }
const authDestination = to => (!hasSession('parent') && !hasSession('child', childId.value)) || ['/parent/login', '/parent/setup-pin'].includes(to.path);
onBeforeRouteLeave(to => authDestination(to) || !busy.value);
onBeforeRouteUpdate(to => to.params.id === childId.value || authDestination(to) || !busy.value);
watch(childId, resetScope, { flush: 'sync' });
watch(() => [calendar.today, calendar.ready, calendar.timeZone], () => refresh());
onMounted(() => {
  refresh();
  document.addEventListener('visibilitychange', resume); window.addEventListener('pageshow', resume);
  window.addEventListener('taskie:data-restored', resetScope); window.addEventListener('taskie:session-changed', resetScope);
  window.addEventListener('taskie:write-confirmed', confirmed); window.addEventListener('taskie:pending-writes', pendingChanged);
});
onBeforeUnmount(() => {
  alive = false; epoch++; readers.forEach(resource => resource.stop());
  document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume);
  window.removeEventListener('taskie:data-restored', resetScope); window.removeEventListener('taskie:session-changed', resetScope);
  window.removeEventListener('taskie:write-confirmed', confirmed); window.removeEventListener('taskie:pending-writes', pendingChanged);
});
</script>
