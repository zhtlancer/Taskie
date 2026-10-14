/**
 * Formats a Date object to YYYY-MM-DD string using local calendar.
 */
function formatDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: require('../config').timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Returns today's date string YYYY-MM-DD.
 */
function getTodayDate() {
  return formatDate(new Date());
}

/**
 * Parses YYYY-MM-DD string to local Date at midnight.
 */
function parseDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw Object.assign(new Error('日期必须为 YYYY-MM-DD'), { status: 400 });
  }
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) {
    throw Object.assign(new Error('日期无效'), { status: 400 });
  }
  return d;
}

/**
 * Returns day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
 */
function getDayOfWeek(dateStr) {
  const d = parseDate(dateStr);
  return d.getUTCDay();
}

/**
 * Shifts date by given number of days.
 */
function shiftDate(dateStr, days) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns date range for the week containing dateStr.
 * Week starts on Monday (1) and ends on Sunday (0).
 */
function getWeekRange(dateStr) {
  const targetDateStr = dateStr || getTodayDate();
  const dow = getDayOfWeek(targetDateStr);
  // If dow is 0 (Sunday), diff to Monday is -6. Otherwise diff is 1 - dow.
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = shiftDate(targetDateStr, diffToMonday);
  const sunday = shiftDate(monday, 6);
  return { startDate: monday, endDate: sunday };
}

/**
 * Returns date range for the week prior to dateStr.
 */
function getLastWeekRange(dateStr) {
  const currentWeek = getWeekRange(dateStr);
  return {
    startDate: shiftDate(currentWeek.startDate, -7),
    endDate: shiftDate(currentWeek.endDate, -7)
  };
}

/**
 * Returns an array of date strings between startDate and endDate inclusive.
 */
function getDateRangeList(startDateStr, endDateStr) {
  const start = parseDate(startDateStr);
  const end = parseDate(endDateStr);
  if (end < start || end - start > 366 * 86400000) {
    throw Object.assign(new Error('日期范围必须在一年以内且开始日期不晚于结束日期'), { status: 400 });
  }
  const list = [];
  let curr = startDateStr;
  while (curr <= endDateStr) {
    list.push(curr);
    curr = shiftDate(curr, 1);
  }
  return list;
}

module.exports = {
  formatDate,
  getTodayDate,
  parseDate,
  getDayOfWeek,
  shiftDate,
  getWeekRange,
  getLastWeekRange,
  getDateRangeList
};
