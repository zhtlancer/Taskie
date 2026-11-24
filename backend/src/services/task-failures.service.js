const { createHash } = require('node:crypto');
const { getTodayDate } = require('../utils/date');
const { cancelPendingSkips } = require('../utils/skips');

class TaskFailuresService {
  constructor(db, tasks) { this.db = db; this.tasks = tasks; }
  task(id) {
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
    if (!task) throw { status: 404, message: '任务不存在' };
    if (!['template', 'adhoc'].includes(task.origin)) throw { status: 409, message: '请在对应学习或课程页面更正进度' };
    return task;
  }
  result(id) { return { success: true, task: this.tasks.describeTask(this.task(id)) }; }
  confirm(id, { request_id, reason, penalty = 0, expected_completed_at } = {}) {
    if (typeof request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(request_id)) throw { status: 400, message: '缺少有效的确认标识' };
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 150) throw { status: 400, message: '请填写 1 至 150 字的未完成原因' };
    if (!Number.isSafeInteger(penalty) || penalty < 0 || penalty > 10000) throw { status: 400, message: '扣分须为 0 至 10000 的整数' };
    if (expected_completed_at !== null && typeof expected_completed_at !== 'string') throw { status: 400, message: '请刷新后核对任务完成状态' };
    const text = reason.trim();
    const fingerprint = createHash('sha256').update(JSON.stringify([id, text, penalty, expected_completed_at])).digest('hex');
    this.db.transaction(() => {
      const task = this.task(id);
      const prior = this.db.prepare('SELECT * FROM task_failures WHERE id = ?').get(request_id);
      if (prior) {
        if (prior.task_id !== id || prior.child_id !== task.child_id || prior.fingerprint !== fingerprint) throw { status: 409, message: '原确认内容已改变，请核对后重新操作' };
        return;
      }
      if (task.failure_id) throw { status: 409, message: '家长已确认这项任务未完成，请刷新后查看' };
      if (task.completed_at !== expected_completed_at) throw { status: 409, message: '任务完成状态已变化，请刷新后重新核对积分' };
      if (task.date > getTodayDate()) throw { status: 409, message: '不能确认未来任务未完成' };
      if (task.skipped_at) throw { status: 409, message: '请先撤销跳过，再确认未完成' };
      if (task.revoked_at || this.tasks.isUnassignedTodayTask(task)) throw { status: 409, message: '任务已取消分配，请刷新' };
      if (this.tasks.scheduleFor(task.child_id).isPaused(task.source_template_id ?? task.template_id, task.date)) throw { status: 409, message: '这项任务已暂停，请先核对安排' };
      if (this.tasks.describeTask(task)?.is_extra) throw { status: 409, message: '额外挑战是自愿的，不需要确认未完成' };
      // Save actual time before undoing completion or closing a running session.
      this.tasks.taskStudyService?.preserveTime(id, { endActive: true });
      if (task.is_completed) this.tasks.uncompleteDailyTask(id, { allowNegativeBalance: true });
      const now = new Date().toISOString();
      cancelPendingSkips(this.db, id, now);
      this.db.prepare('UPDATE homework_records SET completion_requested_at = NULL WHERE daily_task_id = ?').run(id);
      this.db.prepare(`INSERT INTO task_failures(id, task_id, child_id, reason, penalty, fingerprint, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(request_id, id, task.child_id, text, penalty, fingerprint, now);
      this.db.prepare('UPDATE daily_tasks SET failure_id = ?, failed_at = ?, failure_reason = ?, failure_penalty = ? WHERE id = ?')
        .run(request_id, now, text, penalty, id);
      if (penalty) this.db.prepare('INSERT INTO point_logs(id, child_id, daily_task_id, points, earned_at, activity_date, activity_title) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(`failure:${request_id}`, task.child_id, id, -penalty, now, task.date, `${task.title} · 确认未完成（额外扣分）`);
    })();
    return this.result(id);
  }
  restore(id, { failure_id } = {}) {
    if (typeof failure_id !== 'string' || !failure_id) throw { status: 400, message: '缺少未完成确认标识，请刷新' };
    this.db.transaction(() => {
      const task = this.task(id);
      const prior = this.db.prepare('SELECT * FROM task_failures WHERE id = ? AND task_id = ?').get(failure_id, id);
      if (!prior) throw { status: 409, message: '未完成确认记录已变化，请刷新' };
      if (prior.restored_at) return;
      if (task.failure_id !== failure_id) throw { status: 409, message: '任务状态已变化，请刷新' };
      this.db.prepare('UPDATE task_failures SET restored_at = ? WHERE id = ?').run(new Date().toISOString(), failure_id);
      this.db.prepare('DELETE FROM point_logs WHERE id = ?').run(`failure:${failure_id}`);
      this.db.prepare('UPDATE daily_tasks SET failure_id = NULL, failed_at = NULL, failure_reason = NULL, failure_penalty = 0 WHERE id = ?').run(id);
    })();
    return this.result(id);
  }
}
module.exports = TaskFailuresService;
