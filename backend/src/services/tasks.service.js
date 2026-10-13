const { generateId } = require('../utils/crypto');
const { getTodayDate, getDayOfWeek } = require('../utils/date');

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
      SELECT id, title, subject, days_of_week, points, created_at
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
      SELECT id, title, subject, days_of_week, points, created_at
      FROM task_templates
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    return {
      ...row,
      days_of_week: normalizeDaysOfWeek(row.days_of_week)
    };
  }

  createTemplate({ title, subject, days_of_week, points }) {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      throw { status: 400, message: 'Template title is required' };
    }
    if (!subject || typeof subject !== 'string' || subject.trim() === '') {
      throw { status: 400, message: 'Template subject is required' };
    }

    const id = generateId();
    const daysArr = normalizeDaysOfWeek(days_of_week);
    const pts = typeof points === 'number' && points >= 0 ? points : 10;
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, title.trim(), subject.trim(), JSON.stringify(daysArr), pts, createdAt);

    return {
      id,
      title: title.trim(),
      subject: subject.trim(),
      days_of_week: daysArr,
      points: pts,
      created_at: createdAt
    };
  }

  updateTemplate(id, { title, subject, days_of_week, points }) {
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

    this.db.prepare(`
      UPDATE task_templates
      SET title = ?, subject = ?, days_of_week = ?, points = ?
      WHERE id = ?
    `).run(newTitle, newSubject, JSON.stringify(newDays), newPoints, id);

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

    // Query existing daily tasks
    let tasks = this.db.prepare(`
      SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE child_id = ? AND date = ?
      ORDER BY rowid ASC
    `).all(childId, date);

    // If no daily tasks exist for this date, automatically generate from templates matching day of week
    if (tasks.length === 0) {
      const dayOfWeek = getDayOfWeek(date);
      const allTemplates = this.listTemplates();
      const matchingTemplates = allTemplates.filter(t => t.days_of_week.includes(dayOfWeek));

      if (matchingTemplates.length > 0) {
        const insertDailyTask = this.db.prepare(`
          INSERT INTO daily_tasks (id, child_id, template_id, title, subject, points, date, is_completed, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
        `);

        const insertTx = this.db.transaction((tmplList) => {
          for (const tmpl of tmplList) {
            insertDailyTask.run(
              generateId(),
              childId,
              tmpl.id,
              tmpl.title,
              tmpl.subject,
              tmpl.points,
              date
            );
          }
        });

        insertTx(matchingTemplates);

        tasks = this.db.prepare(`
          SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
          FROM daily_tasks
          WHERE child_id = ? AND date = ?
          ORDER BY rowid ASC
        `).all(childId, date);
      }
    }

    return tasks.map(t => ({
      ...t,
      is_completed: Boolean(t.is_completed)
    }));
  }

  completeDailyTask(taskId) {
    const task = this.db.prepare(`
      SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    if (task.is_completed === 1) {
      return {
        success: true,
        task: { ...task, is_completed: true },
        points_earned: 0,
        new_badges: []
      };
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
      SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    return {
      success: true,
      task: {
        ...updatedTask,
        is_completed: Boolean(updatedTask.is_completed)
      },
      points_earned: task.points,
      new_badges: newBadges
    };
  }

  uncompleteDailyTask(taskId) {
    const task = this.db.prepare(`
      SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    if (task.is_completed === 0) {
      return {
        success: true,
        task: { ...task, is_completed: false }
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
      SELECT id, child_id, template_id, title, subject, points, date, is_completed, completed_at
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    return {
      success: true,
      task: {
        ...updatedTask,
        is_completed: Boolean(updatedTask.is_completed)
      }
    };
  }
}

module.exports = TasksService;
