const { formatDate, getTodayDate, shiftDate, getWeekRange, getLastWeekRange, getDateRangeList, getDayOfWeek } = require('../utils/date');
const { isActiveTask, summarizeDay } = require('./tasks.service');

class StatsService {
  constructor(db, tasksService) {
    this.db = db;
    this.tasksService = tasksService;
  }

  // Active tasks grouped by date, described with the same weekly rules as the today view.
  tasksByDate(childId, fromDate, toDate) {
    const byDate = new Map();
    for (const task of this.tasksService.describeTasksBetween(childId, fromDate, toDate).filter(isActiveTask)) {
      if (!byDate.has(task.date)) byDate.set(task.date, []);
      byDate.get(task.date).push(task);
    }
    return byDate;
  }

  getHistory(childId, fromDate, toDate) {
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    const to = toDate || getTodayDate();
    const from = fromDate || shiftDate(to, -29); // default 30 days

    getDateRangeList(from, to);
    const tasksByDate = this.tasksByDate(childId, from, to);

    // Query points by date from point_logs
    const pointLogs = this.db.prepare(`
      SELECT COALESCE(pl.activity_date, dt.date, ptl.date) AS date, COALESCE(SUM(pl.points), 0) AS points
      FROM point_logs pl
      LEFT JOIN daily_tasks dt ON pl.daily_task_id = dt.id
      LEFT JOIN period_task_logs ptl ON ptl.id = pl.period_log_id
      WHERE pl.child_id = ? AND COALESCE(pl.activity_date, dt.date, ptl.date) >= ? AND COALESCE(pl.activity_date, dt.date, ptl.date) <= ?
      GROUP BY COALESCE(pl.activity_date, dt.date, ptl.date)
    `).all(childId, from, to);

    const pointsByDate = new Map();
    for (const p of pointLogs) {
      pointsByDate.set(p.date, p.points);
    }

    const allDates = getDateRangeList(from, to);
    const history = [];

    for (const d of allDates) {
      const dayTasks = tasksByDate.get(d) || [];
      const summary = summarizeDay(dayTasks);
      const completionRate = summary.total > 0 ? Number((summary.completed / summary.total).toFixed(2)) : 0;
      const pointsEarned = pointsByDate.get(d) || 0;

      history.push({
        date: d,
        total_tasks: summary.total,
        completed_tasks: summary.completed,
        completion_rate: completionRate,
        all_done: summary.all_done,
        points_earned: pointsEarned,
        tasks: dayTasks.map(t => ({
          id: t.id,
          template_id: t.template_id,
          title: t.title,
          subject: t.subject,
          points: t.points,
          is_completed: t.is_completed,
          is_optional: t.is_optional,
          completed_at: t.completed_at
        }))
      });
    }

    return history;
  }

  getWeeklySummary(childId, referenceDate) {
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    const currentWeekRange = getWeekRange(referenceDate);
    const lastWeekRange = getLastWeekRange(referenceDate);

    const calcWeekData = (range) => {
      const dates = getDateRangeList(range.startDate, range.endDate);
      const tasksByDate = this.tasksByDate(childId, range.startDate, range.endDate);

      const pointRows = this.db.prepare(`
        SELECT COALESCE(pl.activity_date, dt.date, ptl.date) AS date, COALESCE(SUM(pl.points), 0) AS points
        FROM point_logs pl
        LEFT JOIN daily_tasks dt ON pl.daily_task_id = dt.id
        LEFT JOIN period_task_logs ptl ON ptl.id = pl.period_log_id
        WHERE pl.child_id = ? AND COALESCE(pl.activity_date, dt.date, ptl.date) >= ? AND COALESCE(pl.activity_date, dt.date, ptl.date) <= ?
        GROUP BY COALESCE(pl.activity_date, dt.date, ptl.date)
      `).all(childId, range.startDate, range.endDate);
      const pointsByDate = new Map(pointRows.map(row => [row.date, row.points]));

      const dailyBreakdown = dates.map(d => {
        const dayTasks = tasksByDate.get(d) || [];
        const summary = summarizeDay(dayTasks);
        const dayPoints = pointsByDate.get(d) || 0;

        return {
          date: d,
          day_of_week: getDayOfWeek(d),
          total_tasks: summary.total,
          completed_tasks: summary.completed,
          all_done: summary.all_done,
          points: dayPoints
        };
      });

      const totalTasks = dailyBreakdown.reduce((sum, day) => sum + day.total_tasks, 0);
      const completedTasks = dailyBreakdown.reduce((sum, day) => sum + day.completed_tasks, 0);
      const completionRate = totalTasks > 0 ? Number((completedTasks / totalTasks).toFixed(2)) : 0;

      return {
        start_date: range.startDate,
        end_date: range.endDate,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        completion_rate: completionRate,
        total_points: pointRows.reduce((sum, row) => sum + row.points, 0),
        daily_breakdown: dailyBreakdown,
        completion: this.getWeeklyCompletion(childId, range.startDate, range.endDate)
      };
    };

    return {
      current_week: calcWeekData(currentWeekRange),
      last_week: calcWeekData(lastWeekRange)
    };
  }

  // Weekly completion as of today counts "units" that were due by then: each scheduled day of a
  // fixed-day task up to today is one unit. A weekly "N times" task owes what could no longer be
  // made up in the rest of the week (N minus the days left after today, as in the today view),
  // and completions done ahead count too, never beyond N. Days the app was opened use the tasks
  // generated then; unopened days are projected from the templates that apply now, so they count
  // as missed instead of vanishing. Projection skips days before the child or template existed.
  getWeeklyCompletion(childId, weekStart, weekEnd, asOf = getTodayDate()) {
    const cutoff = asOf < weekEnd ? asOf : weekEnd;
    if (cutoff < weekStart) return { as_of: cutoff, total_units: 0, completed_units: 0, completion_rate: null, items: [] };
    const child = this.db.prepare('SELECT created_at FROM children WHERE id = ?').get(childId);
    const sinceDate = iso => formatDate(new Date(iso));
    const childSince = sinceDate(child.created_at);
    const schedule = this.tasksService.scheduleFor(childId);
    const rows = this.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ? AND date BETWEEN ? AND ? ORDER BY date, rowid')
      .all(childId, weekStart, cutoff)
      .filter(row => row.is_completed || !schedule.isPaused(row.source_template_id ?? row.template_id, row.date));
    const allTemplates = this.tasksService.listTemplates().map(t => ({ ...t, since: sinceDate(t.created_at) }));
    const templatesById = new Map(allTemplates.map(t => [t.id, t]));
    const templates = allTemplates.filter(t => t.child_ids === null || t.child_ids.includes(childId));

    const items = new Map();
    const sourceId = source => source.source_template_id ?? source.template_id ?? (source.date ? null : source.id);
    const keyFor = source => JSON.stringify([sourceId(source) ?? `row:${source.id}`, source.schedule_type || 'fixed_days']);
    const itemFor = (key, source) => {
      if (!items.has(key)) {
        const id = sourceId(source);
        items.set(key, { key, template_id: id, title: source.title, subject: source.subject,
          schedule_type: source.schedule_type || 'fixed_days', total: 0, completed: 0, target: 0, done: 0,
          since: source.template_created_at ? sinceDate(source.template_created_at) : templatesById.get(id)?.since || weekStart,
          legacyOrphan: id === null });
      }
      return items.get(key);
    };

    const openedDates = new Set(rows.map(row => row.date));
    for (const date of getDateRangeList(weekStart, cutoff)) {
      if (openedDates.has(date)) {
        for (const row of rows) {
          if (row.date !== date || row.schedule_type === 'weekly_times') continue;
          const item = itemFor(keyFor(row), row);
          item.total++;
          if (row.is_completed) item.completed++;
        }
      } else if (date >= childSince) {
        for (const t of templates) {
          if (t.schedule_type !== 'weekly_times' && schedule.allowedOn(t.id, date) && t.since <= date) itemFor(keyFor(t), t).total++;
        }
      }
    }

    // The latest generated row carries the target that applied; templates fill in unseen ones.
    for (const row of rows) {
      if (row.schedule_type !== 'weekly_times') continue;
      const item = itemFor(keyFor(row), row);
      item.target = item.legacyOrphan ? 1 : row.weekly_target_times || 1;
      if (row.is_completed) item.done++;
    }
    if (cutoff >= childSince) {
      for (const t of templates) {
        if (t.schedule_type === 'weekly_times' && t.since <= cutoff && !items.has(keyFor(t))) itemFor(keyFor(t), t).target = t.weekly_target_times;
      }
    }

    const list = [...items.values()].map(({ target, done, since, legacyOrphan, ...item }) => {
      if (item.schedule_type !== 'weekly_times') return item;
      const completed = Math.min(done, target);
      // The first week only owes as many occurrences as there are days after
      // creation. Real backfilled completions still count, even before creation.
      const start = [weekStart, childSince, since].sort().at(-1);
      // Weekly tasks limited to some weekdays only owe as many times as those days allow.
      const effectiveTarget = Math.min(target, schedule.availableDays(item.template_id, start, weekEnd));
      const daysAfterCutoff = schedule.availableDays(item.template_id, shiftDate(cutoff, 1), weekEnd);
      // Old deleted templates lost their identity before snapshots existed. Keep
      // each earned completion; do not invent shared quotas from matching titles.
      const due = legacyOrphan ? completed : Math.max(completed, effectiveTarget - daysAfterCutoff, 0);
      return { ...item, total: due, completed, weekly_target: target };
    }).filter(item => item.total > 0);
    const total = list.reduce((sum, item) => sum + item.total, 0);
    const completed = list.reduce((sum, item) => sum + item.completed, 0);
    return {
      as_of: cutoff,
      total_units: total,
      completed_units: completed,
      completion_rate: total > 0 ? Number((completed / total).toFixed(2)) : null,
      items: list
    };
  }
}

module.exports = StatsService;
