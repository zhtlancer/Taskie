export const attendanceLabels = { pending: '未确认', attended: '已上课', leave: '请假', absent: '缺席' };
export const feeText = cents => cents === null || cents === undefined ? '—' : `¥${(cents / 100).toFixed(2)}`;

// One line of the correction history: what a lesson's attendance or the fee was, and became.
const attendanceText = value => (value ? `${attendanceLabels[value.status]}·${value.charged ? '消课' : '未消课'}${value.note ? `（${value.note}）` : ''}` : '未确认');
export function changeText(change) {
  if (change.kind === 'fee') {
    const text = cents => (cents === null ? '未设置' : feeText(cents));
    return `学费 ${text(change.old_value)} → ${text(change.new_value)}`;
  }
  return `${change.lesson_date} 出勤 ${attendanceText(change.old_value)} → ${attendanceText(change.new_value)}`;
}
export function parseFee(value) {
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new Error('学费最多保留两位小数');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents > 1000000000) throw new Error('学费须为 0 至 1000 万元');
  return cents;
}
