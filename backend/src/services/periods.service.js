const { generateId } = require('../utils/crypto');
const { getTodayDate, getDateRangeList, parseDate } = require('../utils/date');

const MODES = ['check', 'progress'];

function validateDate(value, label) {
  try {
    parseDate(value);
  } catch {
    throw { status: 400, message: `${label}必须为 YYYY-MM-DD` };
  }
}

// Holiday and vacation periods, set per child. During a period the parent can pause some daily
// and weekly templates, and add period tasks to finish over the whole period: either checked
// off once, or logged as progress towards a total (e.g. 40 pages), earning points per unit.
class PeriodsService {
  constructor(db, rewardsService) {
    this.db = db;
    this.rewardsService = rewardsService;
  }

  // --- Periods ---

  listPeriods(childId, today = getTodayDate()) {
    this.requireChild(childId);
    return this.db.prepare('SELECT * FROM periods WHERE child_id = ? ORDER BY start_date DESC').all(childId)
      .map(period => this.describePeriod(period, today));
  }

  getPeriod(id) {
    return this.db.prepare('SELECT * FROM periods WHERE id = ?').get(id) || null;
  }

  describePeriod(period, today = getTodayDate()) {
    const status = today < period.start_date ? 'upcoming' : today > period.end_date ? 'ended' : 'active';
    const paused = this.db.prepare('SELECT template_id FROM period_paused_templates WHERE period_id = ?').all(period.id);
    const tasks = this.db.prepare('SELECT * FROM period_tasks WHERE period_id = ? ORDER BY created_at, rowid').all(period.id);
    return {
      ...period,
      status,
      days_total: getDateRangeList(period.start_date, period.end_date).length,
      paused_template_ids: paused.map(row => row.template_id),
      tasks: tasks.map(task => this.describeTask(task, period, today))
    };
  }

  // Progress so far plus pacing: what is left over the days remaining (today included).
  describeTask(task, period, today = getTodayDate()) {
    const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(task.id).done;
    const todayAmount = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM period_task_logs WHERE period_task_id = ? AND date = ?')
      .get(task.id, today).amount;
    const remaining = Math.max(0, task.total_amount - done);
    const daysLeft = today > period.end_date ? 0 : getDateRangeList(today < period.start_date ? period.start_date : today, period.end_date).length;
    const logs = this.db.prepare('SELECT id, amount, date, created_at FROM period_task_logs WHERE period_task_id = ? ORDER BY date DESC, created_at DESC')
      .all(task.id);
    return {
      ...task,
      done_amount: Math.min(done, task.total_amount),
      remaining_amount: remaining,
      is_completed: remaining === 0,
      today_amount: todayAmount,
      days_left: daysLeft,
      // Spread what is left evenly; whatever was already logged today counts towards today's share.
      suggested_today: remaining === 0 || daysLeft === 0 ? 0 : Math.max(0, Math.ceil((remaining + todayAmount) / daysLeft) - todayAmount),
      logs
    };
  }

  createPeriod(childId, body) {
    this.requireChild(childId);
    const fields = this.validatePeriod(childId, body);
    const id = generateId();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO periods (id, child_id, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, childId, fields.name, fields.start_date, fields.end_date, new Date().toISOString());
      this.setPausedTemplates(id, fields.paused_template_ids ?? []);
    })();
    return this.describePeriod(this.getPeriod(id));
  }

  updatePeriod(id, body) {
    const existing = this.getPeriod(id);
    if (!existing) throw { status: 404, message: '假期不存在' };
    const fields = this.validatePeriod(existing.child_id, { ...existing, ...body }, id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE periods SET name = ?, start_date = ?, end_date = ? WHERE id = ?')
        .run(fields.name, fields.start_date, fields.end_date, id);
      if (body.paused_template_ids !== undefined) this.setPausedTemplates(id, fields.paused_template_ids);
    })();
    return this.describePeriod(this.getPeriod(id));
  }

  // Points already earned in the period stay with the child (point_logs keep them, unlinked).
  deletePeriod(id) {
    if (!this.getPeriod(id)) throw { status: 404, message: '假期不存在' };
    this.db.prepare('DELETE FROM periods WHERE id = ?').run(id);
    return { success: true, id };
  }

  validatePeriod(childId, { name, start_date, end_date, paused_template_ids }, ignoreId = null) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 30) throw { status: 400, message: '假期名称不能为空，且不超过 30 个字' };
    validateDate(start_date, '开始日期');
    validateDate(end_date, '结束日期');
    if (end_date < start_date) throw { status: 400, message: '结束日期不能早于开始日期' };
    if (getDateRangeList(start_date, end_date).length > 366) throw { status: 400, message: '假期最长 366 天' };
    // One period per day keeps "which period applies today" unambiguous.
    const overlap = this.db.prepare(`SELECT name FROM periods WHERE child_id = ? AND id != ? AND start_date <= ? AND end_date >= ?`)
      .get(childId, ignoreId ?? '', end_date, start_date);
    if (overlap) throw { status: 409, message: `与「${overlap.name}」的日期重叠` };
    if (paused_template_ids !== undefined && (!Array.isArray(paused_template_ids) || !paused_template_ids.every(id => typeof id === 'string'))) {
      throw { status: 400, message: '暂停的任务列表无效' };
    }
    return { name: name.trim(), start_date, end_date, paused_template_ids };
  }

  setPausedTemplates(periodId, templateIds) {
    this.db.prepare('DELETE FROM period_paused_templates WHERE period_id = ?').run(periodId);
    const exists = this.db.prepare('SELECT id FROM task_templates WHERE id = ?');
    const insert = this.db.prepare('INSERT OR IGNORE INTO period_paused_templates (period_id, template_id) VALUES (?, ?)');
    for (const templateId of templateIds) {
      if (!exists.get(templateId)) throw { status: 400, message: '要暂停的任务不存在' };
      insert.run(periodId, templateId);
    }
  }

  // --- Period tasks ---

  getTask(id) {
    return this.db.prepare('SELECT * FROM period_tasks WHERE id = ?').get(id) || null;
  }

  createTask(periodId, body) {
    const period = this.getPeriod(periodId);
    if (!period) throw { status: 404, message: '假期不存在' };
    const fields = this.validateTask(body);
    const id = generateId();
    this.db.prepare(`INSERT INTO period_tasks (id, period_id, title, subject, mode, total_amount, unit, points, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, periodId, fields.title, fields.subject, fields.mode, fields.total_amount, fields.unit, fields.points, new Date().toISOString());
    return this.describeTask(this.getTask(id), period);
  }

  updateTask(id, body) {
    const existing = this.getTask(id);
    if (!existing) throw { status: 404, message: '假期任务不存在' };
    const fields = this.validateTask({ ...existing, ...body });
    const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(id).done;
    if (fields.mode !== existing.mode && done > 0) throw { status: 409, message: '已有进度记录，不能更改完成方式' };
    this.db.prepare('UPDATE period_tasks SET title = ?, subject = ?, mode = ?, total_amount = ?, unit = ?, points = ? WHERE id = ?')
      .run(fields.title, fields.subject, fields.mode, fields.total_amount, fields.unit, fields.points, id);
    return this.describeTask(this.getTask(id), this.getPeriod(existing.period_id));
  }

  deleteTask(id) {
    if (!this.getTask(id)) throw { status: 404, message: '假期任务不存在' };
    this.db.prepare('DELETE FROM period_tasks WHERE id = ?').run(id);
    return { success: true, id };
  }

  validateTask({ title, subject, mode = 'check', total_amount, unit, points = 0 }) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 50) throw { status: 400, message: '任务名称不能为空，且不超过 50 个字' };
    if (typeof subject !== 'string' || !subject.trim()) throw { status: 400, message: '请选择学科' };
    if (!MODES.includes(mode)) throw { status: 400, message: '完成方式无效' };
    if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw { status: 400, message: '积分必须为 0 至 10000 的整数' };
    if (mode === 'check') return { title: title.trim(), subject: subject.trim(), mode, total_amount: 1, unit: null, points };
    if (!Number.isSafeInteger(total_amount) || total_amount < 1 || total_amount > 100000) throw { status: 400, message: '总量必须为 1 至 100000 的整数' };
    if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 10) throw { status: 400, message: '请填写单位，如 页、篇、次' };
    return { title: title.trim(), subject: subject.trim(), mode, total_amount, unit: unit.trim(), points };
  }

  // --- Progress ---

  // Children log progress for today only; parents may also backfill earlier days of the period.
  logProgress(taskId, { amount, date }, { role }) {
    const task = this.getTask(taskId);
    if (!task) throw { status: 404, message: '假期任务不存在' };
    const period = this.getPeriod(task.period_id);
    const today = getTodayDate();
    const logDate = date ?? today;
    if (role !== 'parent' && logDate !== today) throw { status: 403, message: '只能记录今天的进度' };
    validateDate(logDate, '日期');
    if (logDate < period.start_date || logDate > period.end_date) throw { status: 400, message: '不在假期日期内' };
    if (logDate > today) throw { status: 400, message: '不能记录未来的进度' };
    const logAmount = task.mode === 'check' ? 1 : amount;
    if (!Number.isSafeInteger(logAmount) || logAmount < 1) throw { status: 400, message: '进度必须为正整数' };

    let logId, newBadges = [];
    this.db.transaction(() => {
      const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(taskId).done;
      const remaining = task.total_amount - done;
      if (remaining <= 0) throw { status: 409, message: '这项任务已经完成了' };
      if (logAmount > remaining) throw { status: 400, message: `最多还能记录 ${remaining}${task.unit || ''}` };
      logId = generateId();
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO period_task_logs (id, period_task_id, amount, date, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(logId, taskId, logAmount, logDate, now);
      if (task.points > 0) {
        const title = task.mode === 'progress' ? `${task.title} ${logAmount}${task.unit}` : task.title;
        this.db.prepare('INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at, period_log_id, activity_date, activity_title) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
          .run(generateId(), period.child_id, task.points * logAmount, now, logId, logDate, title);
      }
      if (this.rewardsService) newBadges = this.rewardsService.checkAndUnlockBadges(period.child_id);
    })();
    return {
      success: true,
      log_id: logId,
      points_earned: task.points * logAmount,
      task: this.describeTask(this.getTask(taskId), period),
      new_badges: newBadges
    };
  }

  // Undoing an entry takes back its points. Children may only undo today's entries, and not once
  // those points were spent on rewards; parents can always correct.
  deleteLog(logId, { role }) {
    const log = this.db.prepare(`
      SELECT l.*, p.child_id, t.period_id FROM period_task_logs l
      JOIN period_tasks t ON t.id = l.period_task_id JOIN periods p ON p.id = t.period_id
      WHERE l.id = ?
    `).get(logId);
    if (!log) throw { status: 404, message: '进度记录不存在' };
    if (role !== 'parent') {
      if (log.date !== getTodayDate()) throw { status: 403, message: '只能撤销今天的进度' };
      const earned = this.db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM point_logs WHERE period_log_id = ?').get(logId).points;
      if (this.rewardsService && this.rewardsService.getAvailablePoints(log.child_id) < earned) {
        throw { status: 409, message: '这次进度的积分已用于兑换奖励，不能撤销' };
      }
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM point_logs WHERE period_log_id = ?').run(logId);
      this.db.prepare('DELETE FROM period_task_logs WHERE id = ?').run(logId);
    })();
    return { success: true, task: this.describeTask(this.getTask(log.period_task_id), this.getPeriod(log.period_id)) };
  }

  requireChild(childId) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw { status: 404, message: 'Child not found' };
  }
}

module.exports = PeriodsService;
