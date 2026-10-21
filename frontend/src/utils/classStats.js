export const attendanceLabels = { pending: '未确认', attended: '已上课', leave: '请假', absent: '缺席' };
export const feeText = cents => cents === null || cents === undefined ? '—' : `¥${(cents / 100).toFixed(2)}`;
export function parseFee(value) {
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new Error('学费最多保留两位小数');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents > 1000000000) throw new Error('学费须为 0 至 1000 万元');
  return cents;
}
