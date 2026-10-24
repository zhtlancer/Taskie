// Timetables and outside classes on the board and in the parent console.
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
// Weekdays in display order, Monday first.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const SCHOOL_SUBJECTS = ['语文', '数学', '英语', '科学', '道德与法治', '音乐', '美术', '体育', '信息科技', '劳动', '书法', '班会'];

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function lessonDates(start, days, count) {
  const parsed = new Date(`${start}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== start ||
      !Array.isArray(days) || !days.length || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) ||
      !Number.isSafeInteger(count) || count < 1 || count > 520) return [];
  const dates = [];
  for (let date = start; dates.length < count; date = addDays(date, 1)) {
    if (days.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) dates.push(date);
  }
  return dates;
}

export function mondayOf(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export const shortDate = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const weekdayName = date => WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];

// The deadline of a task that may wait: carried in from an earlier day ("周五的作业 · 周日前完成",
// "… · 今天要完成" on its last day), or its own day's task due later ("周日前完成即可").
export function deadlineText(task, today) {
  if (!task.due_date) return '';
  const due = task.due_date === today ? '今天要完成' : `${weekdayName(task.due_date)}${task.due_date > addDays(today, 6) ? ` ${shortDate(task.due_date)}` : ''}前完成`;
  if (task.carried_from) return `${weekdayName(task.carried_from)}的作业 · ${due}`;
  return task.due_date > (task.date || today) ? `${due === '今天要完成' ? due : `${due}即可`}` : '';
}
export const timeRange = (start, end) => `${start}–${end}`;

// Whether an outside-class lesson takes place that day, and how to say otherwise.
export const lessonHappens = lesson => ['scheduled', 'moved_in'].includes(lesson.status);
export function lessonNote(lesson) {
  if (lesson.status === 'leave') return `请假${lesson.exception_note ? `：${lesson.exception_note}` : ''}`;
  if (lesson.status === 'moved_out') return `调到 ${shortDate(lesson.moved_to.date)} ${timeRange(lesson.moved_to.start_time, lesson.moved_to.end_time)}`;
  if (lesson.status === 'moved_in') return `从 ${shortDate(lesson.moved_from)} 调来`;
  return '';
}

const addMinutes = (time, minutes) => {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// A typical primary school day to start a timetable from: 40-minute lessons from 8:00 with
// 10-minute breaks, 课间操 after the second lesson and 午休 after the fourth; seven lessons.
export function presetSlots(newId = () => Math.random().toString(36).slice(2)) {
  const slots = [];
  let time = '08:00';
  const add = (kind, label, minutes) => {
    slots.push({ id: newId(), kind, label, start_time: time, end_time: addMinutes(time, minutes) });
    time = addMinutes(time, minutes);
  };
  for (let n = 1; n <= 7; n++) {
    add('class', `第${n}节`, 40);
    if (n === 2) add('break', '课间操', 30);
    else if (n === 4) add('break', '午休', 120);
    else if (n < 7) time = addMinutes(time, 10);
  }
  return slots;
}
