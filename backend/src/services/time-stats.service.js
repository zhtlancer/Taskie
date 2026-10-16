const config = require('../config');
const { formatDate, getTodayDate, getDateRangeList, parseDate, shiftDate } = require('../utils/date');

const MAX_DAYS = 366;
// Unrecorded times are estimated from the task's own recorded times over at least this many days,
// and only once it has enough of them.
const ESTIMATE_WINDOW_DAYS = 90;
const MIN_RECORDS_FOR_ESTIMATE = 3;
// Homework finished shortly after midnight still belongs to the evening before.
const EVENING_ENDS_AT = 4 * 60;

const fail = (status, message) => ({ status, message });
const pad = n => String(n).padStart(2, '0');
const sum = list => list.reduce((total, n) => total + n, 0);
const average = list => list.length ? Math.round(sum(list) / list.length) : null;

const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// Minutes after midnight in the family time zone, counting early-morning times as the evening before.
function eveningMinutes(iso) {
  const [h, m] = clockFormat.format(new Date(iso)).split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes < EVENING_ENDS_AT ? minutes + 24 * 60 : minutes;
}
// HH:MM from evening minutes; rounding first keeps 19:59.6 as 20:00.
function clock(minutes) {
  if (minutes === null) return null;
  const rounded = Math.round(minutes);
  return `${pad(Math.floor(rounded / 60) % 24)}:${pad(rounded % 60)}`;
}

// How long a child's homework takes, from the durations of timed tasks and timed long-term progress
// entries, plus when the day's homework was finished (from completion times of every task).
//
// Averages only use recorded durations. Totals give the recorded time and, separately, an estimate
// that fills each unrecorded time with the task's own average (when it has enough records), so a
// week with fewer entries does not look like less homework.
class TimeStatsService {
  constructor(db) {
    this.db = db;
  }

  // Done timed tasks and timed long-term progress entries between two dates, with their duration
  // (null when not recorded). A long-term task's entries from before its first recorded duration
  // were made before timing was in use and are left out. Recorded durations remain visible even
  // after the task's timer is disabled; new untimed progress is not treated as missing time.
  sessions(childId, from, to) {
    const tasks = this.db.prepare(`SELECT date, title, subject, COALESCE(source_template_id, template_id) AS template, duration_seconds, expected_minutes
      FROM daily_tasks WHERE child_id = ? AND date BETWEEN ? AND ? AND is_completed = 1 AND track_time = 1 ORDER BY date, rowid`).all(childId, from, to)
      .map(row => ({
        key: row.template ? `template:${row.template}` : `adhoc:${row.subject}|${row.title}`,
        kind: row.template ? 'template' : 'adhoc',
        date: row.date, title: row.title, subject: row.subject, seconds: row.duration_seconds, expected_minutes: row.expected_minutes
      }));
    const logs = this.db.prepare(`SELECT l.date, l.amount, l.duration_seconds, l.created_at, t.id, t.title, t.subject, t.unit, t.mode, t.expected_minutes,
        (SELECT MIN(created_at) FROM period_task_logs WHERE period_task_id = t.id AND duration_seconds IS NOT NULL) AS timed_since
      FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id
      WHERE t.child_id = ? AND (t.track_time = 1 OR l.duration_seconds IS NOT NULL)
        AND l.date BETWEEN ? AND ? ORDER BY l.date, l.rowid`).all(childId, from, to)
      .filter(log => log.duration_seconds !== null || (log.timed_since && log.created_at >= log.timed_since))
      .map(log => ({
        key: `goal:${log.id}`, kind: 'goal', goal_id: log.id, unit: log.mode === 'progress' ? log.unit : null, amount: log.amount,
        date: log.date, title: log.title, subject: log.subject, seconds: log.duration_seconds, expected_minutes: log.expected_minutes
      }));
    return [...tasks, ...logs];
  }

  // The latest completion of each day in the family's evening time, from every done task and
  // progress entry made on its own day (later corrections and backfills are left out).
  finishTimes(childId, from, to) {
    const rows = [
      ...this.db.prepare('SELECT date, completed_at AS at FROM daily_tasks WHERE child_id = ? AND date BETWEEN ? AND ? AND is_completed = 1 AND completed_at IS NOT NULL')
        .all(childId, from, to),
      ...this.db.prepare(`SELECT l.date, l.created_at AS at FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id
        WHERE t.child_id = ? AND l.date BETWEEN ? AND ?`).all(childId, from, to)
    ];
    const latest = new Map();
    for (const row of rows) {
      const minutes = eveningMinutes(row.at);
      const madeOn = minutes >= 24 * 60 ? shiftDate(formatDate(new Date(row.at)), -1) : formatDate(new Date(row.at));
      if (madeOn !== row.date) continue;
      if (!latest.has(row.date) || minutes > latest.get(row.date)) latest.set(row.date, minutes);
    }
    return latest;
  }

  stats(childId, from, to) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw fail(404, 'Child not found');
    for (const [value, label] of [[from, '开始日期'], [to, '结束日期']]) {
      try { parseDate(value); } catch { throw fail(400, `${label}必须为 YYYY-MM-DD`); }
    }
    if (to < from) throw fail(400, '结束日期不能早于开始日期');
    const dates = getDateRangeList(from, to);
    if (dates.length > MAX_DAYS) throw fail(400, `最多统计 ${MAX_DAYS} 天`);
    // The period just before, as long as this one, to compare with.
    const previousTo = shiftDate(from, -1);
    const previousFrom = shiftDate(from, -dates.length);
    const windowFrom = shiftDate(to, 1 - ESTIMATE_WINDOW_DAYS);
    const all = this.sessions(childId, [previousFrom, windowFrom].sort()[0], to);
    const between = (a, b) => all.filter(s => s.date >= a && s.date <= b);
    const current = between(from, to);
    const previous = between(previousFrom, previousTo);

    const estimates = new Map();
    const recordedByKey = new Map();
    for (const s of between(windowFrom, to).filter(s => s.seconds !== null)) {
      if (!recordedByKey.has(s.key)) recordedByKey.set(s.key, []);
      recordedByKey.get(s.key).push(s.seconds);
    }
    for (const [key, list] of recordedByKey) if (list.length >= MIN_RECORDS_FOR_ESTIMATE) estimates.set(key, average(list));

    const totals = list => {
      const missing = list.filter(s => s.seconds === null);
      const filled = missing.map(s => estimates.get(s.key)).filter(seconds => seconds !== undefined);
      const recorded = sum(list.filter(s => s.seconds !== null).map(s => s.seconds));
      return { recorded_seconds: recorded, estimated_seconds: recorded + sum(filled), missing: missing.length, estimated_missing: filled.length, sessions: list.length };
    };
    const groupBy = (list, keyOf) => {
      const groups = new Map();
      for (const s of list) {
        if (!groups.has(keyOf(s))) groups.set(keyOf(s), []);
        groups.get(keyOf(s)).push(s);
      }
      return groups;
    };

    // ① Each day's time, by subject.
    const finish = this.finishTimes(childId, previousFrom, to);
    const byDate = groupBy(current, s => s.date);
    const days = dates.map(date => {
      const list = byDate.get(date) || [];
      const subjects = {};
      for (const s of list.filter(s => s.seconds !== null)) subjects[s.subject] = (subjects[s.subject] || 0) + s.seconds;
      return { date, ...totals(list), by_subject: subjects, finished_at: clock(finish.get(date) ?? null) };
    });

    // ② Subjects.
    const subjects = [...groupBy(current, s => s.subject)].map(([subject, list]) => ({ subject, ...totals(list) }))
      .sort((a, b) => b.estimated_seconds - a.estimated_seconds);

    // ③④ Each task: averages from recorded times, against its expected time.
    const previousByKey = groupBy(previous.filter(s => s.seconds !== null), s => s.key);
    const tasks = [...groupBy(current, s => s.key)].map(([key, list]) => {
      const recorded = list.filter(s => s.seconds !== null);
      const seconds = recorded.map(s => s.seconds);
      const latest = list.at(-1);
      const expected = latest.expected_minutes;
      const judged = expected ? recorded.filter(s => s.expected_minutes) : [];
      return {
        key, kind: latest.kind, title: latest.title, subject: latest.subject,
        sessions: list.length, recorded: recorded.length,
        average_seconds: average(seconds),
        min_seconds: seconds.length ? Math.min(...seconds) : null,
        max_seconds: seconds.length ? Math.max(...seconds) : null,
        previous_average_seconds: average((previousByKey.get(key) || []).map(s => s.seconds)),
        expected_minutes: expected ?? null,
        over_expected: judged.filter(s => s.seconds > s.expected_minutes * 60).length,
        judged: judged.length,
        points: recorded.map(s => ({ date: s.date, seconds: s.seconds }))
      };
    }).sort((a, b) => (b.average_seconds ?? -1) * b.recorded - (a.average_seconds ?? -1) * a.recorded);

    // ⑤ Long-term tasks measured in units (pages): time per unit, from entries with a duration.
    const perUnit = list => {
      const timed = list.filter(s => s.seconds !== null && s.amount > 0);
      const amount = sum(timed.map(s => s.amount));
      return amount ? Math.round(sum(timed.map(s => s.seconds)) / amount) : null;
    };
    const goals = [...groupBy(current.filter(s => s.kind === 'goal' && s.unit), s => s.goal_id)].map(([id, list]) => ({
      id, title: list.at(-1).title, unit: list.at(-1).unit,
      seconds_per_unit: perUnit(list),
      previous_seconds_per_unit: perUnit(previous.filter(s => s.goal_id === id)),
      amount: sum(list.filter(s => s.seconds !== null).map(s => s.amount)),
      points: [...groupBy(list.filter(s => s.seconds !== null && s.amount > 0), s => s.date)].map(([date, day]) => ({ date, seconds_per_unit: perUnit(day) }))
    })).filter(goal => goal.seconds_per_unit !== null);

    // ⑥ When homework was finished. Today's evening is not over, so its latest completion so far
    // (still in days[].finished_at) stays out of the averages.
    const today = getTodayDate();
    const finishSummary = range => {
      const finishedDays = getDateRangeList(...range).filter(date => date < today);
      const minutes = finishedDays.map(date => finish.get(date)).filter(m => m !== undefined);
      const latestDate = finishedDays.filter(date => finish.get(date) === Math.max(...minutes)).at(-1) ?? null;
      return {
        finish_days: minutes.length,
        finish_average: clock(minutes.length ? sum(minutes) / minutes.length : null),
        finish_latest: clock(minutes.length ? Math.max(...minutes) : null),
        finish_latest_date: latestDate
      };
    };

    return {
      from, to,
      summary: { ...totals(current), ...finishSummary([from, to]) },
      previous: { from: previousFrom, to: previousTo, ...totals(previous), ...finishSummary([previousFrom, previousTo]) },
      days, subjects, tasks, goals
    };
  }
}

module.exports = TimeStatsService;
module.exports.defaultRange = (to = getTodayDate()) => ({ from: shiftDate(to, -6), to });
