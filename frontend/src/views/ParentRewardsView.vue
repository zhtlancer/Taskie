<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title & Actions Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>🎁</span>
            <span>奖励兑换</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            设置孩子可以用积分兑换的奖励；孩子申请后积分先冻结，确认兑换后扣除，拒绝则退回
          </p>
        </div>

        <button
          type="button"
          @click="openAddModal"
          class="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs shadow-button active:scale-95 transition-all"
        >
          <span>➕</span>
          <span>新增奖励</span>
        </button>
      </div>

      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在加载奖励数据...
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left: Pending approvals & history -->
        <div class="lg:col-span-1 space-y-6">
          <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-3 flex items-center justify-between">
              <span>⏳ 待确认的兑换</span>
              <span v-if="pending.length" class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ pending.length }}</span>
            </h3>
            <p v-if="pending.length === 0" class="text-xs font-bold text-slate-400 py-4 text-center">暂时没有新的兑换申请</p>
            <ul v-else class="space-y-3">
              <li v-for="r in pending" :key="r.id" class="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese flex items-center gap-1.5 min-w-0">
                    <span>{{ r.child_avatar_emoji }}</span>
                    <span class="shrink-0">{{ r.child_name }}</span>
                    <span class="text-slate-400 font-medium">想兑换</span>
                  </span>
                  <span class="text-xs font-black text-amber-600 dark:text-amber-300 shrink-0">★ {{ r.cost }}</span>
                </div>
                <div class="text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese mb-3 truncate">{{ r.icon_emoji }} {{ r.title }}</div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    :disabled="busyId === r.id"
                    @click="resolve(r, 'approve')"
                    class="py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 transition-colors"
                  >
                    ✓ 确认兑换
                  </button>
                  <button
                    type="button"
                    :disabled="busyId === r.id"
                    @click="resolve(r, 'reject')"
                    class="py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-300 text-slate-600 dark:text-slate-300 text-xs font-bold disabled:opacity-50 transition-colors"
                  >
                    拒绝并退回积分
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-3">📜 兑换记录</h3>
            <p v-if="history.length === 0" class="text-xs font-bold text-slate-400 py-4 text-center">还没有兑换记录</p>
            <ul v-else class="space-y-2">
              <li v-for="r in history" :key="r.id" class="space-y-2 border-b border-slate-100 dark:border-slate-700 py-2 text-xs" data-redemption-record>
                <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-bold text-slate-700 dark:text-slate-200 font-chinese truncate">
                  {{ r.child_avatar_emoji }} {{ r.child_name }} · {{ r.icon_emoji }} {{ r.title }}
                </span>
                </div>
                <p class="text-slate-500 dark:text-slate-400">原兑换 {{ r.cost }} 分 · {{ ['approved', 'refunded'].includes(r.status) ? '确认' : '处理' }}于 {{ formatTime(r.resolved_at) }}</p>
                <template v-if="r.status === 'refunded'">
                  <p class="font-bold text-emerald-700 dark:text-emerald-300">已退回 {{ r.cost }} 分 · {{ formatTime(r.refunded_at) }}</p>
                  <p class="whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">撤销原因：{{ r.refund_reason }}</p>
                </template>
                <button v-else-if="r.status === 'approved'" type="button" class="min-h-[44px] px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold" @click="refundTarget = r">撤销兑换并退分</button>
                <span class="px-2 py-0.5 rounded-lg font-black shrink-0" :class="statusInfo[r.status].class">
                  {{ statusInfo[r.status].label }}
                </span>
              </li>
            </ul>
            <div v-if="historyPage > 1 || hasMoreHistory" class="flex items-center justify-between gap-2 mt-4 text-xs">
              <button type="button" :disabled="historyLoading || busyId || historyPage === 1" @click="loadHistory(historyPage - 1)" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold disabled:opacity-40">上一页</button>
              <span class="text-slate-500 dark:text-slate-400">第 {{ historyPage }} 页</span>
              <button type="button" :disabled="historyLoading || busyId || !hasMoreHistory" @click="loadHistory(historyPage + 1)" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold disabled:opacity-40">下一页</button>
            </div>
          </section>
        </div>

        <!-- Right: Reward items -->
        <section class="lg:col-span-2">
          <div v-if="items.length === 0" class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
            <div class="text-5xl mb-3">🎁</div>
            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">还没有奖励</h3>
            <p class="text-xs text-slate-400">点击右上角“新增奖励”，例如“看 30 分钟动画 = 50 分”</p>
          </div>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="item in items"
              :key="item.id"
              class="bg-white dark:bg-slate-900 rounded-3xl p-5 border shadow-card flex flex-col justify-between"
              :class="item.is_active ? 'border-slate-200/80 dark:border-slate-700/80' : 'border-dashed border-slate-300 dark:border-slate-600 opacity-70'"
            >
              <div class="flex items-start justify-between gap-3 mb-4">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="text-4xl">{{ item.icon_emoji }}</span>
                  <div class="min-w-0">
                    <h4 class="text-base font-bold text-slate-800 dark:text-slate-100 font-chinese truncate">{{ item.title }}</h4>
                    <span class="text-sm font-black text-amber-500 dark:text-amber-400">★ {{ item.cost }} 积分</span>
                  </div>
                </div>
                <span
                  class="px-2 py-0.5 rounded-lg text-xs font-black shrink-0"
                  :class="item.is_active ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'"
                >
                  {{ item.is_active ? '上架中' : '已下架' }}
                </span>
              </div>
              <div class="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    @click="openEditModal(item)"
                    class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
                  >
                    ✏️ 编辑
                  </button>
                  <button
                    type="button"
                    @click="toggleActive(item)"
                    class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
                  >
                    {{ item.is_active ? '下架' : '重新上架' }}
                  </button>
                </div>
                <button
                  type="button"
                  @click="handleDelete(item)"
                  class="px-3 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <RefundRedemptionDialog v-if="refundTarget" :redemption="refundTarget" @close="refundTarget = null" @saved="afterRefund" />
    <!-- Add/Edit Reward Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="showModal = false"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-brand-100 dark:border-brand-800">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-black text-slate-800 dark:text-slate-100">{{ editingId ? '✏️ 编辑奖励' : '➕ 新增奖励' }}</h3>
          <button type="button" @click="showModal = false" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold text-lg">✕</button>
        </div>

        <form @submit.prevent="submitForm" class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">奖励名称</label>
            <input
              v-model="form.title"
              type="text"
              required
              maxlength="50"
              placeholder="例如：看30分钟动画、周末去公园"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none font-chinese"
            />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">图标</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="icon in iconOptions"
                :key="icon"
                type="button"
                @click="form.icon_emoji = icon"
                class="w-10 h-10 rounded-xl text-xl border transition-all"
                :class="form.icon_emoji === icon ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-500 scale-110' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'"
              >
                {{ icon }}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">所需积分</label>
            <div class="flex items-center gap-2">
              <button
                v-for="cost in [50, 100, 200, 500]"
                :key="cost"
                type="button"
                @click="form.cost = cost"
                class="px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all"
                :class="form.cost === cost ? 'bg-amber-400 border-amber-400 text-amber-950 dark:text-amber-200 font-black shadow-sm' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
              >
                ★ {{ cost }}
              </button>
              <input
                v-model.number="form.cost"
                type="number"
                min="1"
                max="100000"
                class="w-24 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-center focus:border-brand-500 outline-none"
              />
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button type="button" @click="showModal = false" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting || !form.title.trim() || !(Number.isInteger(form.cost) && form.cost >= 1)"
              class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50 transition-all"
            >
              {{ submitting ? '保存中...' : '确认保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { confirmAction } from '../utils/confirmation';
import { ref, onMounted } from 'vue';
import api from '../api/client';
import { getPendingRedemptions } from '../api/redemptions';
import ParentNavBar from '../components/ParentNavBar.vue';
import RefundRedemptionDialog from '../components/RefundRedemptionDialog.vue';
import { useCalendarStore } from '../stores/calendar';
const calendar = useCalendarStore();
const formatTime = time => time ? new Date(time).toLocaleString('zh-CN', { timeZone: calendar.timeZone, hour12: false }) : '未知';
const refundTarget = ref(null);
async function afterRefund() { refundTarget.value = null; await load(); }

const items = ref([]);
const pending = ref([]);
const history = ref([]);
const historyPage = ref(1);
const hasMoreHistory = ref(false);
const historyLoading = ref(false);
const historyPageSize = 15;
const loading = ref(true);
const busyId = ref(null);

const showModal = ref(false);
const editingId = ref(null);
const submitting = ref(false);
const form = ref({ title: '', icon_emoji: '🎁', cost: 100 });

const iconOptions = ['🎁', '📺', '🎮', '🍦', '🧸', '🎡', '📚', '🚲', '⚽', '🍔', '🎨', '🌟'];

const statusInfo = {
  pending: { label: '待确认', class: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  approved: { label: '已兑换', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  rejected: { label: '已拒绝', class: 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300' },
  cancelled: { label: '孩子撤回', class: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' },
  refunded: { label: '已撤销退分', class: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' }
};

onMounted(load);

function fetchHistory(page) {
  return api.getRedemptions('history', { limit: historyPageSize + 1, offset: (page - 1) * historyPageSize });
}

function setHistory(rows, page) {
  history.value = rows.slice(0, historyPageSize);
  hasMoreHistory.value = rows.length > historyPageSize;
  historyPage.value = page;
}

async function loadHistory(page) {
  historyLoading.value = true;
  try {
    setHistory(await fetchHistory(page), page);
  } catch (err) {
    console.error('Failed to load redemption history:', err);
  } finally {
    historyLoading.value = false;
  }
}

async function load() {
  try {
    const [nextItems, nextPending, rows] = await Promise.all([
      api.getRewardItems(),
      getPendingRedemptions(params => api.getRedemptions(params.status, params)),
      fetchHistory(historyPage.value)
    ]);
    items.value = nextItems;
    pending.value = nextPending;
    setHistory(rows, historyPage.value);
  } catch (err) {
    console.error('Failed to load rewards:', err);
  } finally {
    loading.value = false;
  }
}

async function resolve(redemption, action) {
  busyId.value = redemption.id;
  try {
    await (action === 'approve' ? api.approveRedemption(redemption.id) : api.rejectRedemption(redemption.id));
  } catch (err) {
    console.error('Failed to resolve redemption:', err);
  } finally {
    busyId.value = null;
    await load();
  }
}

function openAddModal() {
  editingId.value = null;
  form.value = { title: '', icon_emoji: '🎁', cost: 100 };
  showModal.value = true;
}

function openEditModal(item) {
  editingId.value = item.id;
  form.value = { title: item.title, icon_emoji: item.icon_emoji, cost: item.cost };
  showModal.value = true;
}

async function submitForm() {
  submitting.value = true;
  try {
    const payload = { title: form.value.title.trim(), icon_emoji: form.value.icon_emoji, cost: form.value.cost };
    await (editingId.value ? api.updateRewardItem(editingId.value, payload) : api.createRewardItem(payload));
    showModal.value = false;
    await load();
  } catch (err) {
    console.error('Failed to save reward:', err);
  } finally {
    submitting.value = false;
  }
}

async function toggleActive(item) {
  try {
    await api.updateRewardItem(item.id, { is_active: !item.is_active });
    await load();
  } catch (err) {
    console.error('Failed to toggle reward:', err);
  }
}

async function handleDelete(item) {
  if (!await confirmAction(`确定删除奖励「${item.title}」吗？已有的兑换记录会保留。`)) return;
  try {
    await api.deleteRewardItem(item.id);
    await load();
  } catch (err) {
    console.error('Failed to delete reward:', err);
  }
}
</script>
