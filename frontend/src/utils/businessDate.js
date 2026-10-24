// Match the server's family calendar even when the device uses a different time zone.
export function businessDate(now = Date.now(), timeZone) {
  if (!timeZone) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
export function businessClock(now = Date.now(), timeZone) {
  if (!timeZone) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
}
export function businessDayLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()]} · ${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
