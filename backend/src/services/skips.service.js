const { generateId } = require('../utils/crypto');
const { getTodayDate } = require('../utils/date');
const { isActiveTask } = require('./tasks.service');

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'revoked'];
const MAX_REASON_LENGTH = 50;

function validateReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) throw { status: 400, message: '请写下跳过的理由' };
  if (reason.trim().length > MAX_REASON_LENGTH) throw { status: 400, message: `理由不超过 ${MAX_REASON_LENGTH} 个字` };
  return reason.trim();
}

// Skipping a task for its day: a child asks with a reason and a parent approves or rejects it; a
// parent may also skip a task directly or take a skip back. Approval marks the task row (skipped_at),
// which the day summary, weekly completion and streak treat as not required that day. Each skipped
// time of a weekly task uses up one of its weekly target.
class SkipsService {
  constructor(db, tasksService, rewardsService) {
    this.db = db;
    this.tasksService = tasksService;
    this.rewardsService = rewardsService;
  }

  listRequests({ childId, status, limit = 200, offset = 0 } = {}) {
    if (status !== undefined && ![...STATUSES, 'history'].includes(status)) throw { status: 400, message: '申请状态无效' };
    const parseInteger = value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    limit = parseInteger(limit);
    offset = parseInteger(offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      throw { status: 400, message: '分页参数无效' };
    }
    const where = [], params = [];
    if (childId) { where.push('r.child_id = ?'); params.push(childId); }
    if (status === 'history') where.push("r.status != 'pending'");
    else if (status) { where.push('r.status = ?'); params.push(status); }
    return this.db.prepare(`
      SELECT r.*, d.title AS task_title, d.subject AS task_subject, d.date AS task_date,
        c.name AS child_name, c.avatar_emoji AS child_avatar_emoji
      FROM task_skip_requests r
      JOIN daily_tasks d ON d.id = r.daily_task_id
      JOIN children c ON c.id = r.child_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.requested_at DESC, r.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  }

  getRequest(id) {
    return this.db.prepare('SELECT * FROM task_skip_requests WHERE id = ?').get(id) || null;
  }

  // A task can be skipped while it is still to do that day: not done, not already skipped, not in
  // the future, still assigned and not paused, and (for a weekly task) the weekly target not used up.
  skippableTask(taskId) {
    const row = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (!row) throw { status: 404, message: '任务不存在' };
    if (row.is_completed) throw { status: 409, message: '这项任务已经完成了' };
    if (row.skipped_at) throw { status: 409, message: '这项任务已经跳过了' };
    if (row.date > getTodayDate()) throw { status: 400, message: '不能跳过以后的任务' };
    if (this.tasksService.isUnassignedTodayTask(row)) throw { status: 409, message: '任务已取消分配，请刷新今日任务' };
    if (this.tasksService.scheduleFor(row.child_id).isPaused(row.source_template_id ?? row.template_id, row.date)) {
      throw { status: 409, message: '假期中这项任务已暂停，请刷新今日任务' };
    }
    const task = this.tasksService.describeTask(row);
    if (!task) throw { status: 409, message: '这项任务今天已不需要完成' };
    if (!isActiveTask(task)) throw { status: 409, message: '本周目标已完成，不需要跳过' };
    return row;
  }

  markSkipped(row, reason, now) {
    this.db.prepare('UPDATE daily_tasks SET skipped_at = ?, skip_reason = ? WHERE id = ?').run(now, reason, row.id);
  }

  // A parent's skip takes effect at once and settles a request still waiting; a child's waits for
  // a parent. Once a parent turned a request down or took a skip back, the child cannot ask again.
  requestSkip(taskId, reason, { role }) {
    const text = validateReason(reason);
    const now = new Date().toISOString();
    let row, requestId;
    this.db.transaction(() => {
      row = this.skippableTask(taskId);
      const pending = this.db.prepare("SELECT id FROM task_skip_requests WHERE daily_task_id = ? AND status = 'pending'").get(row.id);
      if (role === 'parent') {
        if (pending) {
          requestId = pending.id;
          this.db.prepare("UPDATE task_skip_requests SET status = 'approved', resolved_at = ? WHERE id = ?").run(now, requestId);
          this.markSkipped(row, this.getRequest(requestId).reason, now);
          return;
        }
        requestId = generateId();
        this.db.prepare(`INSERT INTO task_skip_requests (id, daily_task_id, child_id, reason, requested_by, status, requested_at, resolved_at)
          VALUES (?, ?, ?, ?, 'parent', 'approved', ?, ?)`).run(requestId, row.id, row.child_id, text, now, now);
        this.markSkipped(row, text, now);
        return;
      }
      if (pending) throw { status: 409, message: '已经申请过了，等家长确认吧' };
      if (this.db.prepare("SELECT 1 FROM task_skip_requests WHERE daily_task_id = ? AND status IN ('rejected', 'revoked')").get(row.id)) {
        throw { status: 409, message: '家长没有同意跳过这项任务，今天还是要完成哦' };
      }
      requestId = generateId();
      this.db.prepare(`INSERT INTO task_skip_requests (id, daily_task_id, child_id, reason, requested_by, status, requested_at)
        VALUES (?, ?, ?, ?, 'child', 'pending', ?)`).run(requestId, row.id, row.child_id, text, now);
    })();
    return this.result(requestId, row);
  }

  resolveRequest(id, status) {
    const now = new Date().toISOString();
    let row;
    this.db.transaction(() => {
      const request = this.getRequest(id);
      if (!request) throw { status: 404, message: '跳过申请不存在' };
      if (request.status !== 'pending') throw { status: 409, message: '这条申请已经处理过了' };
      if (status === 'approved') {
        row = this.skippableTask(request.daily_task_id);
        this.markSkipped(row, request.reason, now);
      }
      this.db.prepare('UPDATE task_skip_requests SET status = ?, resolved_at = ? WHERE id = ?').run(status, now, id);
    })();
    return this.result(id, row || this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(this.getRequest(id).daily_task_id));
  }

  // A parent taking a skip back makes the task required again that day.
  unskip(taskId) {
    const row = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (!row) throw { status: 404, message: '任务不存在' };
    if (!row.skipped_at) throw { status: 409, message: '这项任务没有跳过' };
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('UPDATE daily_tasks SET skipped_at = NULL, skip_reason = NULL WHERE id = ?').run(row.id);
      this.db.prepare("UPDATE task_skip_requests SET status = 'revoked', resolved_at = ? WHERE daily_task_id = ? AND status = 'approved'").run(now, row.id);
    })();
    return { success: true, task: this.tasksService.describeTask({ ...row, skipped_at: null }) };
  }

  // An approved skip may finish the day, so badges such as 全勤王 are checked again.
  result(requestId, row) {
    const request = this.getRequest(requestId);
    const approved = request.status === 'approved';
    return {
      request,
      task: this.tasksService.describeTask(this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(row.id)),
      new_badges: approved && this.rewardsService ? this.rewardsService.checkAndUnlockBadges(row.child_id) : []
    };
  }
}

module.exports = SkipsService;
