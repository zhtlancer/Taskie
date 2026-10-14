const { getTodayDate, shiftDate, getWeekRange, getLastWeekRange, getDateRangeList, getDayOfWeek } = require('../utils/date');
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
      SELECT dt.date, COALESCE(SUM(pl.points), 0) AS points
      FROM point_logs pl
      JOIN daily_tasks dt ON pl.daily_task_id = dt.id
      WHERE pl.child_id = ? AND dt.date >= ? AND dt.date <= ?
      GROUP BY dt.date
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

      const pointsRow = this.db.prepare(`
        SELECT COALESCE(SUM(pl.points), 0) AS total_points
        FROM point_logs pl
        JOIN daily_tasks dt ON pl.daily_task_id = dt.id
        WHERE pl.child_id = ? AND dt.date >= ? AND dt.date <= ?
      `).get(childId, range.startDate, range.endDate);

      const dailyBreakdown = dates.map(d => {
        const dayTasks = tasksByDate.get(d) || [];
        const summary = summarizeDay(dayTasks);
        const dayPoints = dayTasks.filter(t => t.is_completed).reduce((sum, t) => sum + t.points, 0);

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
        total_points: pointsRow ? pointsRow.total_points : 0,
        daily_breakdown: dailyBreakdown
      };
    };

    return {
      current_week: calcWeekData(currentWeekRange),
      last_week: calcWeekData(lastWeekRange)
    };
  }
}

module.exports = StatsService;
