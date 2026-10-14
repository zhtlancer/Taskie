const { generateId } = require('../utils/crypto');
const { getTodayDate, getDayOfWeek, getWeekRange, parseDate } = require('../utils/date');

function normalizeDaysOfWeek(days) {
  if (Array.isArray(days)) {
    return days.map(d => parseInt(d, 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6);
  }
  if (typeof days === 'string') {
    try {
      const parsed = JSON.parse(days);
      if (Array.isArray(parsed)) {
        return parsed.map(d => parseInt(d, 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6);
      }
    } catch {
      return days.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6);
    }
  }
  return [0, 1, 2, 3, 4, 5, 6];
}

class TasksService {
  constructor(db, rewardsService) {
    this.db = db;
    this.rewardsService = rewardsService;
  }

  // --- Task Templates ---

  listTemplates() {
    const rows = this.db.prepare(`
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times
      FROM task_templates
      ORDER BY created_at ASC
    `).all();

    return rows.map(r => ({
      ...r,
      days_of_week: normalizeDaysOfWeek(r.days_of_week)
    }));
  }

  getTemplate(id) {
    const row = this.db.prepare(`
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times
      FROM task_templates
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    return {
      ...row,
      days_of_week: normalizeDaysOfWeek(row.days_of_week)
    };
  }

  createTemplate({ title, subject, days_of_week, points, schedule_type = 'fixed_days', weekly_target_times = null }) {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      throw { status: 400, message: 'Template title is required' };
    }
    if (!subject || typeof subject !== 'string' || subject.trim() === '') {
      throw { status: 400, message: 'Template subject is required' };
    }

    if (!['fixed_days', 'weekly_times'].includes(schedule_type) ||
      schedule_type === 'weekly_times' && (!Number.isInteger(weekly_target_times) || weekly_target_times < 1 || weekly_target_times > 7)) {
      throw { status: 400, message: '每周目标必须为 1 至 7 次' };
    }
    if (points !== undefined && (!Number.isSafeInteger(points) || points < 0 || points > 10000)) {
      throw { status: 400, message: '积分必须为 0 至 10000 的整数' };
    }
    const id = generateId();
    const daysArr = normalizeDaysOfWeek(days_of_week);
    const pts = typeof points === 'number' && points >= 0 ? points : 10;
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title.trim(), subject.trim(), JSON.stringify(daysArr), pts, createdAt, schedule_type, schedule_type === 'weekly_times' ? weekly_target_times : null);

    return {
      id,
      title: title.trim(),
      subject: subject.trim(),
      days_of_week: daysArr,
      points: pts,
      created_at: createdAt, schedule_type, weekly_target_times: schedule_type === 'weekly_times' ? weekly_target_times : null
    };
  }

  updateTemplate(id, { title, subject, days_of_week, points, schedule_type, weekly_target_times }) {
    const existing = this.getTemplate(id);
    if (!existing) {
      throw { status: 404, message: 'Template not found' };
    }

    const newTitle = (title !== undefined && typeof title === 'string' && title.trim() !== '')
      ? title.trim() : existing.title;
    const newSubject = (subject !== undefined && typeof subject === 'string' && subject.trim() !== '')
      ? subject.trim() : existing.subject;
    const newDays = days_of_week !== undefined
      ? normalizeDaysOfWeek(days_of_week) : existing.days_of_week;
    const newPoints = (points !== undefined && typeof points === 'number' && points >= 0)
      ? points : existing.points;

    const schedule = schedule_type ?? existing.schedule_type;
    const target = weekly_target_times ?? existing.weekly_target_times;
    if (!['fixed_days', 'weekly_times'].includes(schedule) || schedule === 'weekly_times' && (!Number.isInteger(target) || target < 1 || target > 7)) {
      throw { status: 400, message: '每周目标必须为 1 至 7 次' };
    }
    if (points !== undefined && (!Number.isSafeInteger(points) || points < 0 || points > 10000)) throw { status: 400, message: '积分无效' };
    this.db.prepare(`
      UPDATE task_templates
      SET title = ?, subject = ?, days_of_week = ?, points = ?, schedule_type = ?, weekly_target_times = ?
      WHERE id = ?
    `).run(newTitle, newSubject, JSON.stringify(newDays), newPoints, schedule, schedule === 'weekly_times' ? target : null, id);

    return this.getTemplate(id);
  }

  deleteTemplate(id) {
    const existing = this.getTemplate(id);
    if (!existing) {
      throw { status: 404, message: 'Template not found' };
    }

    this.db.prepare('DELETE FROM task_templates WHERE id = ?').run(id);
    return { success: true, id };
  }

  // --- Daily Tasks ---

  getDailyTasks(childId, targetDate) {
    if (!childId) {
      throw { status: 400, message: 'child_id is required' };
    }

    // Verify child exists
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    const date = targetDate || getTodayDate();

    parseDate(date);
    const dayOfWeek = getDayOfWeek(date);
    const matching = this.listTemplates().filter(t => t.schedule_type === 'weekly_times' || t.days_of_week.includes(dayOfWeek));
    this.db.transaction(() => {
      const exists = this.db.prepare('SELECT id FROM daily_tasks WHERE child_id = ? AND date = ? AND template_id = ?');
      const insert = this.db.prepare(`INSERT INTO daily_tasks
        (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`);
      for (const t of matching) {
        if (!exists.get(childId, date, t.id) && (t.schedule_type !== 'weekly_times' || this.weeklyCount(childId, t.id, date) < t.weekly_target_times)) {
          insert.run(generateId(), childId, t.id, t.title, t.subject, t.points, date, t.schedule_type, t.weekly_target_times);
        }
      }
    })();
    return this.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ? AND date = ? ORDER BY rowid').all(childId, date)
      .map(t => this.describeTask(t)).filter(t => t.schedule_type !== 'weekly_times' || t.is_completed || t.weekly_completed_times < t.weekly_target_times);
  }

  weeklyCount(childId, templateId, date) {
    const { startDate, endDate } = getWeekRange(date);
    return this.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ? AND template_id = ? AND date BETWEEN ? AND ? AND is_completed = 1')
      .get(childId, templateId, startDate, endDate).n;
  }

  describeTask(t) {
    return { ...t, is_completed: Boolean(t.is_completed),
      weekly_completed_times: t.schedule_type === 'weekly_times' ? this.weeklyCount(t.child_id, t.template_id, t.date) : undefined };
  }

  completeDailyTask(taskId) {
    const task = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    if (task.is_completed === 1) {
      return {
        success: true,
        task: this.describeTask(task),
        points_earned: 0,
        new_badges: []
      };
    }

    if (task.date > getTodayDate()) throw { status: 400, message: '不能提前完成未来的任务' };
    if (task.schedule_type === 'weekly_times' && this.weeklyCount(task.child_id, task.template_id, task.date) >= task.weekly_target_times) {
      throw { status: 409, message: '本周目标已完成' };
    }
    const now = new Date().toISOString();
    let newBadges = [];

    const tx = this.db.transaction(() => {
      // 1. Update task to completed
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 1, completed_at = ?
        WHERE id = ?
      `).run(now, taskId);

      // 2. Insert point log
      this.db.prepare(`
        INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateId(), task.child_id, task.id, task.points, now);

      // 3. Trigger badge unlocks
      if (this.rewardsService) {
        newBadges = this.rewardsService.checkAndUnlockBadges(task.child_id);
      }
    });

    tx();

    const updatedTask = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    return {
      success: true,
      task: this.describeTask(updatedTask),
      points_earned: task.points,
      new_badges: newBadges
    };
  }

  uncompleteDailyTask(taskId) {
    const task = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    if (task.is_completed === 0) {
      return {
        success: true,
        task: this.describeTask(task)
      };
    }

    const tx = this.db.transaction(() => {
      // 1. Revert task
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 0, completed_at = NULL
        WHERE id = ?
      `).run(taskId);

      // 2. Remove point log for this daily task
      this.db.prepare(`
        DELETE FROM point_logs
        WHERE daily_task_id = ?
      `).run(taskId);
    });

    tx();

    const updatedTask = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    return {
      success: true,
      task: this.describeTask(updatedTask)
    };
  }
}

module.exports = TasksService;
