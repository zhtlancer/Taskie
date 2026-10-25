const StudySessionsService = require('./study-sessions.service');
const { getTodayDate } = require('../utils/date');
const fail = (status, message) => ({ status, message });

class HomeworkStudyService extends StudySessionsService {
  constructor(db, homework, tasks, timers) { super(db, tasks, timers); this.homework = homework; }

  task(recordId) {
    const record = this.homework.get(recordId);
    if (!record.task) throw fail(409, '请先由家长生成打卡任务');
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(record.task.id);
    return { record: { ...record, task: { ...record.task, track_time: Boolean(task.track_time), expected_minutes: task.expected_minutes } }, task };
  }

  complete(recordId, actor) {
    const { task } = this.task(recordId);
    if (task.is_completed) return;
    if (task.skipped_at || task.date > getTodayDate()) throw fail(409, '作业已跳过或尚未开始');
    if (this.db.prepare('SELECT 1 FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(task.id)) throw fail(409, '请先结束本次学习');
    if (actor !== 'parent' && !this.tasks.childMayActOn(task)) {
      this.db.prepare('UPDATE homework_records SET completion_requested_at = COALESCE(completion_requested_at, ?) WHERE id = ?').run(new Date().toISOString(), recordId);
      return;
    }
    this.tasks.completeDailyTask(task.id, { duration_seconds: null, completionSource: actor === 'parent' && !this.tasks.childMayActOn(task) ? 'parent_backfill' : null });
    this.db.prepare('UPDATE homework_records SET completion_requested_at = NULL WHERE id = ?').run(recordId);
  }

  reject(recordId) {
    this.homework.get(recordId);
    this.db.prepare('UPDATE homework_records SET completion_requested_at = NULL WHERE id = ?').run(recordId);
    return this.details(recordId);
  }
}
module.exports = HomeworkStudyService;
module.exports.splitSeconds = StudySessionsService.splitSeconds;
