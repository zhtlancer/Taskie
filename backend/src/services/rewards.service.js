const { generateId } = require('../utils/crypto');
const { getTodayDate, shiftDate } = require('../utils/date');

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

  getCurrentStreak(childId, referenceDate) {
    const today = referenceDate || getTodayDate();
    const yesterday = shiftDate(today, -1);

    const rows = this.db.prepare(`
      SELECT DISTINCT date
      FROM daily_tasks
      WHERE child_id = ? AND is_completed = 1
      ORDER BY date DESC
    `).all(childId);

    const completedDates = new Set(rows.map(r => r.date));

    if (completedDates.has(today)) {
      let streak = 0;
      let curr = today;
      while (completedDates.has(curr)) {
        streak++;
        curr = shiftDate(curr, -1);
      }
      return streak;
    }

    if (completedDates.has(yesterday)) {
      let streak = 0;
      let curr = yesterday;
      while (completedDates.has(curr)) {
        streak++;
        curr = shiftDate(curr, -1);
      }
      return streak;
    }

    return 0;
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
      const days = new Map();
      for (const row of this.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ?').all(childId)) {
        const task = this.tasksService.describeTask(row);
        if (task.schedule_type === 'weekly_times' && !task.is_completed && task.weekly_completed_times >= task.weekly_target_times) continue;
        if (!days.has(task.date)) days.set(task.date, []);
        days.get(task.date).push(task);
      }
      return [...days.values()].filter(tasks => tasks.length && tasks.every(task => task.is_completed)).length;
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

    if (this.tasksService && today === getTodayDate()) {
      const active = this.tasksService.getDailyTasks(childId, today);
      todayTasksRow = { total: active.length, completed: active.filter(t => t.is_completed).length };
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
      JOIN daily_tasks dt ON pl.daily_task_id = dt.id
      WHERE pl.child_id = ? AND dt.date = ?
    `).get(childId, today);

    const todayPoints = todayPointsRow ? todayPointsRow.points : 0;

    return {
      total_points: totalPoints,
      available_points: totalPoints - this.getSpentPoints(childId),
      current_streak: currentStreak,
      today_total_tasks: todayTotal,
      today_completed_tasks: todayCompleted,
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
