const { getTodayDate, shiftDate, getWeekRange, getLastWeekRange, getDateRangeList, getDayOfWeek } = require('../utils/date');

class StatsService {
  constructor(db) {
    this.db = db;
  }

  getHistory(childId, fromDate, toDate) {
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    const to = toDate || getTodayDate();
    const from = fromDate || shiftDate(to, -29); // default 30 days

    const tasks = this.db.prepare(`
      SELECT id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE child_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC, rowid ASC
    `).all(childId, from, to);

    // Group tasks by date
    const tasksByDate = new Map();
    for (const t of tasks) {
      if (!tasksByDate.has(t.date)) {
        tasksByDate.set(t.date, []);
      }
      tasksByDate.get(t.date).push({
        id: t.id,
        template_id: t.template_id,
        title: t.title,
        subject: t.subject,
        points: t.points,
        is_completed: Boolean(t.is_completed),
        completed_at: t.completed_at
      });
    }

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
      const totalTasks = dayTasks.length;
      const completedTasks = dayTasks.filter(t => t.is_completed).length;
      const completionRate = totalTasks > 0 ? Number((completedTasks / totalTasks).toFixed(2)) : 0;
      const pointsEarned = pointsByDate.get(d) || 0;

      history.push({
        date: d,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        completion_rate: completionRate,
        points_earned: pointsEarned,
        tasks: dayTasks
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
      const tasks = this.db.prepare(`
        SELECT id, template_id, title, subject, points, date, is_completed, completed_at
        FROM daily_tasks
        WHERE child_id = ? AND date >= ? AND date <= ?
      `).all(childId, range.startDate, range.endDate);

      const pointsRow = this.db.prepare(`
        SELECT COALESCE(SUM(pl.points), 0) AS total_points
        FROM point_logs pl
        JOIN daily_tasks dt ON pl.daily_task_id = dt.id
        WHERE pl.child_id = ? AND dt.date >= ? AND dt.date <= ?
      `).get(childId, range.startDate, range.endDate);

      const tasksByDate = new Map();
      for (const t of tasks) {
        if (!tasksByDate.has(t.date)) {
          tasksByDate.set(t.date, []);
        }
        tasksByDate.get(t.date).push(t);
      }

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.is_completed === 1).length;
      const completionRate = totalTasks > 0 ? Number((completedTasks / totalTasks).toFixed(2)) : 0;

      const dailyBreakdown = dates.map(d => {
        const dayTasks = tasksByDate.get(d) || [];
        const dayTotal = dayTasks.length;
        const dayCompleted = dayTasks.filter(t => t.is_completed === 1).length;
        const dayPoints = dayTasks.filter(t => t.is_completed === 1).reduce((sum, t) => sum + t.points, 0);

        return {
          date: d,
          day_of_week: getDayOfWeek(d),
          total_tasks: dayTotal,
          completed_tasks: dayCompleted,
          points: dayPoints
        };
      });

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
