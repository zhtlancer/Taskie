/**
 * Formats a Date object to YYYY-MM-DD string using local calendar.
 */
function formatDate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  if (!dateStr || typeof dateStr !== 'string') {
    return new Date();
  }
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date();
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Returns day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
 */
function getDayOfWeek(dateStr) {
  const d = parseDate(dateStr);
  return d.getDay();
}

/**
 * Shifts date by given number of days.
 */
function shiftDate(dateStr, days) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
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
