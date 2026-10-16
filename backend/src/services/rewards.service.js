const { generateId } = require('../utils/crypto');
const { getTodayDate, shiftDate } = require('../utils/date');
const { summarizeDay } = require('./tasks.service');

class RewardsService {
  constructor(db) {
    this.db = db;
  }

  getTotalPoints(childId) {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(points), 0) AS total
      FROM point_logs
      WHERE child_id = ?
    `).get(childId);
    return row ? row.total : 0;
  }

  // Points held by pending requests are already unavailable, so a child cannot over-request.
  getSpentPoints(childId) {
    return this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) AS spent
      FROM reward_redemptions
      WHERE child_id = ? AND status IN ('pending', 'approved')
    `).get(childId).spent;
  }

  getAvailablePoints(childId) {
    return this.getTotalPoints(childId) - this.getSpentPoints(childId);
  }

  // Consecutive days with a completed task. Rest days (nothing required was scheduled, such as a
  // weekend without tasks) are skipped rather than breaking the streak, and today only counts once
  // something is done, so an unfinished today never breaks it either.
  getCurrentStreak(childId, referenceDate) {
    const today = referenceDate || getTodayDate();
    // Logging holiday-task progress counts as doing something that day.
    const completedDates = new Set(this.db.prepare(`
      SELECT date FROM daily_tasks WHERE child_id = ? AND is_completed = 1 AND date <= ?
      UNION
      SELECT l.date FROM period_task_logs l
      JOIN period_tasks t ON t.id = l.period_task_id
      WHERE t.child_id = ? AND l.date <= ?
    `).all(childId, today, childId, today).map(r => r.date));
    if (completedDates.size === 0) return 0;

    const earliest = [...completedDates].sort()[0];
    const isRestDay = this.tasksService
      ? this.tasksService.restDayChecker(childId, earliest, today)
      : () => false;
    let streak = 0;
    for (let date = completedDates.has(today) ? today : shiftDate(today, -1); date >= earliest; date = shiftDate(date, -1)) {
      if (completedDates.has(date)) streak++;
      else if (!isRestDay(date)) break;
    }
    return streak;
  }

  getTotalCompletedTasksCount(childId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM daily_tasks
      WHERE child_id = ? AND is_completed = 1
    `).get(childId);
    return row ? row.count : 0;
  }

  getAllDoneDaysCount(childId) {
    if (this.tasksService) {
      const range = this.db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM daily_tasks WHERE child_id = ?').get(childId);
      if (!range.first) return 0;
      const days = new Map();
      // Tasks carried past their deadline count as missed on their last day, which may come later.
      for (const task of this.tasksService.summaryTasksBetween(childId, range.first, [range.last, getTodayDate()].sort().at(-1))) {
        if (!days.has(task.date)) days.set(task.date, []);
        days.get(task.date).push(task);
      }
      return [...days.values()].filter(tasks => summarizeDay(tasks).all_done).length;
    }
    const rows = this.db.prepare(`
      SELECT date, COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
      FROM daily_tasks
      WHERE child_id = ?
      GROUP BY date
      HAVING total > 0 AND total = completed
    `).all(childId);
    return rows.length;
  }

  getChildStats(childId, referenceDate) {
    // Verify child exists
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    let today = referenceDate || getTodayDate();
    let todayTasksRow = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
      FROM daily_tasks
      WHERE child_id = ? AND date = ?
    `).get(childId, today);

    if (this.tasksService) {
      // Today's tasks are generated on demand; other dates only describe what already exists.
      todayTasksRow = summarizeDay(today === getTodayDate()
        ? this.tasksService.getDailyTasks(childId, today)
        : this.tasksService.describeTasksBetween(childId, today, today));
    }

    const totalPoints = this.getTotalPoints(childId);
    const currentStreak = this.getCurrentStreak(childId, today);

    const todayTotal = todayTasksRow ? todayTasksRow.total : 0;
    const todayCompleted = todayTasksRow ? (todayTasksRow.completed || 0) : 0;
    const todayCompletionRate = todayTotal > 0 ? Number((todayCompleted / todayTotal).toFixed(2)) : 0;

    // Today's earned points
    const todayPointsRow = this.db.prepare(`
      SELECT COALESCE(SUM(pl.points), 0) AS points
      FROM point_logs pl
      LEFT JOIN daily_tasks dt ON pl.daily_task_id = dt.id
      LEFT JOIN period_task_logs ptl ON ptl.id = pl.period_log_id
      WHERE pl.child_id = ? AND COALESCE(pl.activity_date, dt.date, ptl.date) = ?
    `).get(childId, today);

    const todayPoints = todayPointsRow ? todayPointsRow.points : 0;

    return {
      total_points: totalPoints,
      available_points: totalPoints - this.getSpentPoints(childId),
      current_streak: currentStreak,
      today_total_tasks: todayTotal,
      today_completed_tasks: todayCompleted,
      today_skipped_tasks: todayTasksRow?.skipped || 0,
      today_completion_rate: todayCompletionRate,
      today_points: todayPoints
    };
  }

  listBadgeDefinitions() {
    return this.db.prepare(`
      SELECT id, key, name, description, icon_emoji, condition_type, condition_value
      FROM badge_definitions
      ORDER BY rowid ASC
    `).all();
  }

  getChildBadges(childId) {
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    return this.db.prepare(`
      SELECT cb.id, cb.badge_id, cb.unlocked_at, bd.key, bd.name, bd.description, bd.icon_emoji, bd.condition_type, bd.condition_value
      FROM child_badges cb
      JOIN badge_definitions bd ON cb.badge_id = bd.id
      WHERE cb.child_id = ?
      ORDER BY cb.unlocked_at DESC
    `).all(childId);
  }

  checkAndUnlockBadges(childId) {
    const lockedBadges = this.db.prepare(`
      SELECT id, key, name, description, icon_emoji, condition_type, condition_value
      FROM badge_definitions
      WHERE id NOT IN (SELECT badge_id FROM child_badges WHERE child_id = ?)
    `).all(childId);

    if (lockedBadges.length === 0) {
      return [];
    }

    const totalPoints = this.getTotalPoints(childId);
    const currentStreak = this.getCurrentStreak(childId);
    const totalCompletedTasks = this.getTotalCompletedTasksCount(childId);
    const allDoneCount = this.getAllDoneDaysCount(childId);

    const newlyUnlocked = [];
    const now = new Date().toISOString();

    const insertBadge = this.db.prepare(`
      INSERT INTO child_badges (id, child_id, badge_id, unlocked_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const badge of lockedBadges) {
      let isEligible = false;

      if (badge.key === 'first_complete' || badge.condition_type === 'first_complete') {
        isEligible = totalCompletedTasks >= 1;
      } else if (badge.condition_type === 'streak_days') {
        isEligible = currentStreak >= badge.condition_value;
      } else if (badge.condition_type === 'total_points') {
        isEligible = totalPoints >= badge.condition_value;
      } else if (badge.condition_type === 'tasks_completed') {
        isEligible = totalCompletedTasks >= badge.condition_value;
      } else if (badge.condition_type === 'all_done_count' || badge.key === 'all_done_once' || badge.key === 'all_done_10') {
        isEligible = allDoneCount >= badge.condition_value;
      }

      if (isEligible) {
        const id = generateId();
        try {
          insertBadge.run(id, childId, badge.id, now);
          newlyUnlocked.push({
            id,
            badge_id: badge.id,
            key: badge.key,
            name: badge.name,
            description: badge.description,
            icon_emoji: badge.icon_emoji,
            condition_type: badge.condition_type,
            condition_value: badge.condition_value,
            unlocked_at: now
          });
        } catch {
          // ignore duplicate insert race
        }
      }
    }

    return newlyUnlocked;
  }
}

module.exports = RewardsService;
