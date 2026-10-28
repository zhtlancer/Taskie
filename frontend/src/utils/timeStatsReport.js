// Dates are calendar dates in the family time zone, never device-local instants.
export function validateStatsRange(from, to) {
  const valid = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!valid(from) || !valid(to)) return '请选择有效的开始日期和结束日期';
  if (to < from) return '结束日期不能早于开始日期';
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 >= 366) return '最多统计 366 天';
  return '';
}

export const estimateSeconds = row => Math.max(0, row.estimated_seconds - row.recorded_seconds);
export const unestimatedCount = row => Math.max(0, row.missing - row.estimated_missing);
export const taskKindLabel = kind => ({ template: '模板任务', goal: '长期任务', homework: '课程作业', adhoc: '临时任务' })[kind] || kind;
export const TIME_STATS_NOTE = '已记录用时包含计时器、手动补记及历史累计，不等同于全部实测。系统补估按同项任务在区间结束日前 90 天内至少 3 次已记录用时的平均值计算；含估算合计不包含仍无法估算的用时。';

// Quote every field, keep unknown values empty and neutralize spreadsheet formulas in user text.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function timeStatsCsv(stats, childName, timeZone, kind) {
  const context = [childName, stats.from, stats.to, timeZone];
  const headers = ['孩子', '开始日期', '结束日期', '家庭时区'];
  let rows;
  if (kind === 'daily') {
    headers.push('日期', '已记录用时（秒）', '系统补估（秒）', '含估算合计（秒）', '统计次数', '未记录次数', '已估算次数', '未能估算次数', '当日最后完成时间');
    rows = stats.days.map(day => [...context, day.date, day.recorded_seconds, estimateSeconds(day), day.estimated_seconds,
      day.sessions, day.missing, day.estimated_missing, unestimatedCount(day), day.finished_at]);
  } else if (kind === 'tasks') {
    headers.push('任务', '学科', '类型', '已记录用时（秒）', '系统补估（秒）', '含估算合计（秒）', '统计次数', '已记录次数', '未记录次数', '已估算次数', '未能估算次数',
      '平均已记录用时（秒）', '最快（秒）', '最慢（秒）', '预计用时（分钟）', '可比较次数', '超时次数');
    rows = stats.tasks.map(task => [...context, task.title, task.subject, taskKindLabel(task.kind), task.recorded_seconds, estimateSeconds(task), task.estimated_seconds,
      task.sessions, task.recorded, task.missing, task.estimated_missing, unestimatedCount(task), task.average_seconds, task.min_seconds, task.max_seconds,
      task.expected_minutes, task.judged, task.over_expected]);
  } else throw new Error('未知的统计导出类型');
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function timeStatsFilename(stats, childName, kind) {
  const name = String(childName).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').slice(0, 60) || '孩子';
  return `${name}-用时统计-${stats.from}_${stats.to}-${kind === 'daily' ? '按日' : '按任务'}.csv`;
}
