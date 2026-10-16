// Time stats: chart colors, ranges and the wording shared by the parent and child views.
import { addDays, localDate } from './schedule.js';

// Subjects keep one color everywhere (validated as a categorical set on the white card surface;
// yellow and aqua sit below 3:1, so charts always carry values in a legend, labels or a table).
export const SUBJECTS = ['语文', '数学', '英语', '其他'];
export const SUBJECT_COLORS = { 语文: '#2a78d6', 数学: '#eb6834', 英语: '#1baf7a', 其他: '#eda100' };
// The estimated time of unrecorded tasks: neutral, never a series hue.
export const ESTIMATE_COLOR = '#c3c2b7';
export const CHART_INK = { grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781', secondary: '#52514e', surface: '#ffffff' };

export const subjectOf = subject => SUBJECTS.includes(subject) ? subject : '其他';

// 1 小时 20 分 / 35 分 / 不到 1 分; null for nothing.
export function formatMinutes(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return seconds > 0 ? '不到 1 分' : '0 分';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} 分`;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

// "多 20 分" / "少 5 分" / "持平" against the period before (null when there is nothing to compare).
export function minutesDelta(current, previous) {
  if (!previous) return null;
  const diff = Math.round((current - previous) / 60);
  if (diff === 0) return '持平';
  return diff > 0 ? `多 ${formatMinutes(diff * 60)}` : `少 ${formatMinutes(-diff * 60)}`;
}

// The ranges a parent can pick: the last 7 or 30 days, and the current term from the timetable.
export function rangePresets(timetables = [], today = localDate()) {
  const presets = [
    { key: '7', label: '近 7 天', from: addDays(today, -6), to: today },
    { key: '30', label: '近 30 天', from: addDays(today, -29), to: today }
  ];
  const term = timetables.find(t => t.start_date <= today && t.end_date >= today);
  if (term) presets.push({ key: 'term', label: `本学期（${term.name}）`, from: term.start_date, to: today });
  return presets;
}

// Encouragement for the child: tasks done at least a minute faster on average than in the period
// before, and long-term tasks read faster per page. Only gains, never "slower".
export function improvements(stats) {
  const items = [];
  for (const task of stats.tasks) {
    if (task.average_seconds === null || task.previous_average_seconds === null) continue;
    const gain = task.previous_average_seconds - task.average_seconds;
    if (gain >= 60) items.push({ key: task.key, text: `${task.title} 平均比之前快了 ${Math.round(gain / 60)} 分钟` });
  }
  for (const goal of stats.goals) {
    if (goal.previous_seconds_per_unit && goal.seconds_per_unit < goal.previous_seconds_per_unit) {
      items.push({ key: goal.id, text: `${goal.title} 每${goal.unit}用时从 ${formatPerUnit(goal.previous_seconds_per_unit)} 缩短到 ${formatPerUnit(goal.seconds_per_unit)}` });
    }
  }
  return items;
}

// Time per page, in minutes with one decimal under ten (2.5 分钟), whole minutes above.
export function formatPerUnit(seconds) {
  const minutes = seconds / 60;
  return `${minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)} 分钟`;
}
