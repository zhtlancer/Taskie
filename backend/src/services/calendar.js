const { getDayOfWeek, shiftDate } = require('../utils/date');

// A break can carry a task this long at most (a summer holiday fits); beyond it the break is
// treated as over, so a calendar mistake never carries a task for ever.
const MAX_CARRY_DAYS = 120;

// A child's school calendar: school days are Monday to Friday outside the child's holiday periods,
// plus make-up school days (调休上学日), which follow another weekday's tasks and timetable and are
// school days even inside a holiday period.
function schoolCalendar(db, childId) {
  // Holiday periods and make-up days in one query.
  const rows = db.prepare(`SELECT 'period' AS kind, NULL AS id, name, start_date, end_date, NULL AS acts_as, NULL AS note FROM periods WHERE child_id = ?
    UNION ALL SELECT 'makeup', id, NULL, date, date, acts_as, note FROM makeup_days WHERE child_id = ?`).all(childId, childId);
  const periods = rows.filter(row => row.kind === 'period');
  const makeups = new Map(rows.filter(row => row.kind === 'makeup').map(row => [row.start_date, { id: row.id, date: row.start_date, acts_as: row.acts_as, note: row.note }]));
  const makeupOn = date => makeups.get(date) || null;
  const holidayOn = date => makeups.has(date) ? null : periods.find(p => p.start_date <= date && p.end_date >= date) || null;
  const isSchoolDay = date => makeups.has(date) || (!holidayOn(date) && ![0, 6].includes(getDayOfWeek(date)));
  return {
    makeupOn,
    holidayOn,
    isSchoolDay,
    // The weekday whose tasks and lessons apply: a make-up day follows the weekday it stands in for.
    weekdayOf: date => makeups.get(date)?.acts_as ?? getDayOfWeek(date),
    // The last day a task of this date may be done when it may wait out the break that follows:
    // the last day of that break, or the day itself when school goes on the next day (or the day
    // is no school day itself).
    carryUntil(date) {
      if (!isSchoolDay(date)) return date;
      let end = date;
      for (let i = 0; i < MAX_CARRY_DAYS && !isSchoolDay(shiftDate(end, 1)); i++) end = shiftDate(end, 1);
      return end;
    }
  };
}

// The last day a task may be done: a one-off task's own due date, a carried-over task's break end,
// otherwise its own day.
function dueDateOf(row, calendar) {
  if (row.due_date) return row.due_date;
  return row.carry_over ? calendar.carryUntil(row.date) : row.date;
}

module.exports = { schoolCalendar, dueDateOf, MAX_CARRY_DAYS };
