const StudySessionsService = require('./study-sessions.service');
const { generateId } = require('../utils/crypto');
const { getTodayDate } = require('../utils/date');
const { isActiveTask } = require('./tasks.service');
const { MAX_DURATION_SECONDS } = require('../utils/timer');

class TaskStudyService extends StudySessionsService {
  // Destructive task edits also need this conversion, even if no client opened /study yet.
  // Stay in the caller's transaction and keep unknown past runs as a legacy aggregate.
  preserveTime(id, { endActive = false, convert = true } = {}) {
    return this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
      if (!task) return null;
      if (!['goal', 'study'].includes(task.origin) && task.homework_legacy_seconds === null &&
          (task.track_time || task.duration_seconds !== null || task.timer_started_at || task.timer_elapsed_seconds > 0) &&
          !this.db.prepare('SELECT 1 FROM homework_records WHERE daily_task_id = ?').get(id)) {
        const legacy = task.duration_seconds ?? task.timer_elapsed_seconds ?? 0;
        // Undo must remain compatible with old timer clients. Keep the last actual duration in
        // their aggregate until /study is opened, rather than forcing their next completion to
        // use the new session API. A manual correction takes precedence over the stopwatch.
        if (!convert) {
          if (task.is_completed && task.duration_seconds !== null) {
            this.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = ?, timer_started_at = NULL WHERE id = ?').run(legacy, id);
          }
          return this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
        }
        if (task.timer_started_at && !task.is_completed) {
          const sid = generateId();
          this.db.prepare(`INSERT INTO homework_sessions(id, task_id, child_id, started_at, timer_started_at)
            VALUES (?, ?, ?, ?, ?)`).run(sid, task.id, task.child_id, task.timer_started_at, task.timer_started_at);
          if (endActive) {
            // The old timer capped elapsed + running at 12 hours, not each part separately.
            const cutoff = Math.min(Date.now(), Date.parse(task.timer_started_at) + Math.max(0, MAX_DURATION_SECONDS - legacy) * 1000);
            this.pause(this.session(id, sid), cutoff);
          }
        }
        this.db.prepare(`UPDATE daily_tasks SET homework_legacy_seconds = ?, duration_seconds = NULL,
          duration_source = NULL, timer_elapsed_seconds = 0, timer_started_at = NULL WHERE id = ?`).run(legacy, id);
      }
      if (endActive) this.endActive(id);
      return this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
    })();
  }

  task(id) {
    let task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
    if (!task) throw { status: 404, message: '任务不存在' };
    if (['goal', 'study'].includes(task.origin)) throw { status: 409, message: '请在对应学习页面记录进度' };
    if (this.db.prepare('SELECT 1 FROM homework_records WHERE daily_task_id = ?').get(id)) throw { status: 409, message: '请在课程作业中记录学习' };
    if (!task.track_time && task.homework_legacy_seconds === null) throw { status: 409, message: '这项任务未开启记录用时' };
    task = this.preserveTime(id);
    const described = this.tasks.describeTask(task);
    return { task, record: { subject: task.subject, content: task.title, assigned_date: task.date,
      task: { ...described, due_date: described?.due_date || task.date } } };
  }

  checkStart(task) {
    if (!task.track_time) throw { status: 409, message: '这项任务已关闭记录用时' };
    if (!this.tasks.childMayActOn(task)) throw { status: 409, message: '只能给今天或尚未到截止日期的任务计时' };
    if (this.tasks.isUnassignedTodayTask(task) || this.tasks.scheduleFor(task.child_id).isPaused(task.source_template_id ?? task.template_id, task.date)) {
      throw { status: 409, message: '这项任务已暂停或取消分配' };
    }
    const described = this.tasks.describeTask(task);
    if (!described || !isActiveTask(described)) throw { status: 409, message: '本周目标已完成' };
  }

  checkActor(task, actor, action) {
    if (actor !== 'parent' && task.completion_source === 'parent_backfill') throw { status: 403, message: '家长补卡记录请由家长修改' };
    if (actor !== 'parent' && action && action !== 'finish' && !this.tasks.childMayActOn(task)) throw { status: 403, message: '任务已超期，请由家长更正记录' };
  }

  complete(id, actor) {
    const { task } = this.task(id);
    this.checkActor(task, actor);
    if (actor !== 'parent' && !this.tasks.childMayActOn(task)) throw { status: 403, message: '任务已超期，请由家长补卡' };
    const late = actor === 'parent' && task.date < getTodayDate() && !this.tasks.childMayActOn(task);
    return this.tasks[late ? 'backfillDailyTask' : 'completeDailyTask'](id, { duration_seconds: null });
  }
}

module.exports = TaskStudyService;
