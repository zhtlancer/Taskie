// A moved lesson keeps the date it was originally scheduled for, even when several lessons of
// the same class land on one day. Older task rows fall back to their board date.
const classLessonKey = lesson => JSON.stringify([lesson.class_id, lesson.class_lesson_date ?? lesson.date]);

// Calendar dates, independent of device time zone or school holidays. One selected weekday
// contributes one lesson per week; leave/moves keep the original lesson's identity.
function lessonDates(start, days, count) {
  const { parseDate, shiftDate } = require('./date');
  parseDate(start);
  if (!Array.isArray(days) || !days.length || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) ||
      !Number.isSafeInteger(count) || count < 1 || count > 520) throw Object.assign(new Error('总课次须为 1 至 520 的整数，并选择上课星期'), { status: 400 });
  const dates = [];
  for (let date = start; dates.length < count; date = shiftDate(date, 1)) {
    if (days.includes(parseDate(date).getUTCDay())) dates.push(date);
  }
  return dates;
}

module.exports = { classLessonKey, lessonDates };
