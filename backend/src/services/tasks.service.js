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

// null means the template applies to every child.
function normalizeChildIds(childIds) {
  if (childIds === null) return null;
  if (!Array.isArray(childIds) || childIds.length === 0 || !childIds.every(id => typeof id === 'string' && id)) {
    throw { status: 400, message: '请至少选择一个孩子，或设为全部孩子' };
  }
  return [...new Set(childIds)];
}

// Weekly tasks whose target is already met are hidden unless completed that day.
function isActiveTask(task) {
  return task.schedule_type !== 'weekly_times' || task.is_completed || task.weekly_completed_times < task.weekly_target_times;
}

// Optional weekly tasks only count once completed, so skipping one never breaks a day,
// and a day with nothing completed is never all done.
function summarizeDay(tasks) {
  const counted = tasks.filter(task => isActiveTask(task) && (!task.is_optional || task.is_completed));
  const completed = counted.filter(task => task.is_completed).length;
  return { total: counted.length, completed, all_done: completed > 0 && completed === counted.length };
}

class TasksService {
  constructor(db, rewardsService) {
    this.db = db;
    this.rewardsService = rewardsService;
  }

  // --- Task Templates ---

  listTemplates() {
    const rows = this.db.prepare(`
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all
      FROM task_templates
      ORDER BY created_at ASC
    `).all();

    const assigned = new Map();
    for (const { template_id, child_id } of this.db.prepare('SELECT template_id, child_id FROM template_children').all()) {
      if (!assigned.has(template_id)) assigned.set(template_id, []);
      assigned.get(template_id).push(child_id);
    }
    return rows.map(r => this.describeTemplate(r, assigned.get(r.id)));
  }

  describeTemplate({ assign_all, ...row }, childIds = []) {
    return {
      ...row,
      days_of_week: normalizeDaysOfWeek(row.days_of_week),
      child_ids: assign_all ? null : childIds
    };
  }

  setTemplateChildren(templateId, childIds) {
    this.db.prepare('DELETE FROM template_children WHERE template_id = ?').run(templateId);
    this.db.prepare('UPDATE task_templates SET assign_all = ? WHERE id = ?').run(childIds === null ? 1 : 0, templateId);
    if (childIds === null) return;
    const exists = this.db.prepare('SELECT id FROM children WHERE id = ?');
    const insert = this.db.prepare('INSERT INTO template_children (template_id, child_id) VALUES (?, ?)');
    for (const childId of childIds) {
      if (!exists.get(childId)) throw { status: 400, message: '指定的孩子不存在' };
      insert.run(templateId, childId);
    }
    this.removeUnassignedTodayTasks(templateId);
  }

  removeUnassignedTodayTasks(templateId = null) {
    // Assignment edits revoke pending tasks today, while completed and historical
    // snapshots (and their point logs) remain intact.
    this.db.prepare(`DELETE FROM daily_tasks
      WHERE date = ? AND is_completed = 0 AND (? IS NULL OR template_id = ?)
        AND EXISTS (SELECT 1 FROM task_templates WHERE id = daily_tasks.template_id AND assign_all = 0)
        AND NOT EXISTS (SELECT 1 FROM template_children
          WHERE template_id = daily_tasks.template_id AND child_id = daily_tasks.child_id)`)
      .run(getTodayDate(), templateId, templateId);
  }

  isUnassignedTodayTask(task) {
    if (task.date !== getTodayDate()) return false;
    const template = this.getTemplate(task.template_id);
    return template && template.child_ids !== null && !template.child_ids.includes(task.child_id);
  }

  getTemplate(id) {
    const row = this.db.prepare(`
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all
      FROM task_templates
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    const childIds = this.db.prepare('SELECT child_id FROM template_children WHERE template_id = ?').all(id).map(r => r.child_id);
    return this.describeTemplate(row, childIds);
  }

  createTemplate({ title, subject, days_of_week, points, schedule_type = 'fixed_days', weekly_target_times = null, child_ids = null }) {
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
    const childIds = normalizeChildIds(child_ids);
    const id = generateId();
    const daysArr = normalizeDaysOfWeek(days_of_week);
    const pts = typeof points === 'number' && points >= 0 ? points : 10;
    const createdAt = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title.trim(), subject.trim(), JSON.stringify(daysArr), pts, createdAt, schedule_type, schedule_type === 'weekly_times' ? weekly_target_times : null);
      this.setTemplateChildren(id, childIds);
    })();

    return this.getTemplate(id);
  }

  updateTemplate(id, { title, subject, days_of_week, points, schedule_type, weekly_target_times, child_ids }) {
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
    const childIds = child_ids === undefined ? undefined : normalizeChildIds(child_ids);
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE task_templates
        SET title = ?, subject = ?, days_of_week = ?, points = ?, schedule_type = ?, weekly_target_times = ?
        WHERE id = ?
      `).run(newTitle, newSubject, JSON.stringify(newDays), newPoints, schedule, schedule === 'weekly_times' ? target : null, id);
      if (childIds !== undefined) this.setTemplateChildren(id, childIds);
    })();

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
    const matching = this.listTemplates().filter(t => (t.child_ids === null || t.child_ids.includes(childId)) &&
      (t.schedule_type === 'weekly_times' || t.days_of_week.includes(dayOfWeek)));
    this.db.transaction(() => {
      if (date === getTodayDate()) this.removeUnassignedTodayTasks();
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
    return this.describeTasksBetween(childId, date, date).filter(isActiveTask);
  }

  weeklyCount(childId, templateId, date) {
    const { startDate, endDate } = getWeekRange(date);
    return this.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ? AND template_id = ? AND date BETWEEN ? AND ? AND is_completed = 1')
      .get(childId, templateId, startDate, endDate).n;
  }

  describeTask(t) {
    return this.describeTasksBetween(t.child_id, t.date, t.date).find(task => task.id === t.id);
  }

  // Describes a child's tasks between two dates with weekly progress, using one query over
  // the surrounding weeks. A weekly task is optional on a day while the times still needed
  // (counting only earlier days, so past days never change) are fewer than the days left
  // in the week including that day; once there is no slack it is required that day.
  describeTasksBetween(childId, fromDate, toDate) {
    const weekStarts = new Map();
    const weekOf = date => {
      if (!weekStarts.has(date)) weekStarts.set(date, getWeekRange(date).startDate);
      return weekStarts.get(date);
    };
    const rows = this.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ? AND date BETWEEN ? AND ? ORDER BY date, rowid')
      .all(childId, weekOf(fromDate), getWeekRange(toDate).endDate);
    const keyOf = row => `${weekOf(row.date)}|${row.template_id ?? row.id}`;
    const completions = new Map();
    for (const row of rows) {
      if (row.schedule_type !== 'weekly_times' || !row.is_completed) continue;
      if (!completions.has(keyOf(row))) completions.set(keyOf(row), []);
      completions.get(keyOf(row)).push(row.date);
    }

    return rows.filter(row => row.date >= fromDate && row.date <= toDate).map(row => {
      const task = { ...row, is_completed: Boolean(row.is_completed) };
      if (row.schedule_type !== 'weekly_times') return { ...task, is_optional: false };
      const done = completions.get(keyOf(row)) || [];
      const target = row.weekly_target_times || 1;
      const dayOfWeek = getDayOfWeek(row.date);
      const daysLeft = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      return {
        ...task,
        weekly_completed_times: done.length,
        weekly_remaining_times: Math.max(0, target - done.length),
        week_days_left: daysLeft,
        is_optional: target - done.filter(date => date < row.date).length < daysLeft
      };
    });
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
    if (this.isUnassignedTodayTask(task)) throw { status: 409, message: '任务已取消分配，请刷新今日任务' };
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

  uncompleteDailyTask(taskId, { allowNegativeBalance = false } = {}) {
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

    // Undoing a task must not refund points that were already spent on rewards.
    if (!allowNegativeBalance && this.rewardsService) {
      const earned = this.db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM point_logs WHERE daily_task_id = ?').get(taskId).points;
      if (this.rewardsService.getAvailablePoints(task.child_id) < earned) {
        throw { status: 409, message: '这项任务的积分已用于兑换奖励，不能取消打卡' };
      }
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
      this.removeUnassignedTodayTasks(task.template_id);
    });

    tx();

    const updatedTask = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    return {
      success: true,
      task: this.describeTask(updatedTask || { ...task, is_completed: 0, completed_at: null })
    };
  }
}

module.exports = TasksService;
module.exports.isActiveTask = isActiveTask;
module.exports.summarizeDay = summarizeDay;
