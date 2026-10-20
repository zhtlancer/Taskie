const { timerSeconds } = require('../utils/timer');

// Timers for timed tasks: today's daily tasks and running long-term tasks. Homework is done one
// thing at a time, so starting a timer pauses whatever else the child was timing.
class TimersService {
  constructor(db, tasksService, periodsService) {
    this.db = db;
    this.tasksService = tasksService;
    this.periodsService = periodsService;
    this.kinds = {
      task: {
        table: 'daily_tasks',
        load: id => this.dailyTaskForTimer(id),
        describe: row => this.tasksService.describeTask(this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(row.id))
      },
      goal: {
        table: 'period_tasks',
        load: id => this.goalForTimer(id),
        describe: row => this.periodsService.describeTask(this.periodsService.getTask(row.id))
      }
    };
  }

  dailyTaskForTimer(id) {
    const row = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
    if (!row) throw { status: 404, message: '任务不存在' };
    if (this.db.prepare('SELECT 1 FROM homework_records WHERE daily_task_id = ?').get(id)) throw { status: 409, message: '请在作业学习记录中计时' };
    if (!row.track_time) throw { status: 409, message: '这项任务不记录用时' };
    if (row.is_completed) throw { status: 409, message: '这项任务已经完成了' };
    if (row.skipped_at) throw { status: 409, message: '这项任务今天已跳过' };
    if (!this.tasksService.childMayActOn(row)) throw { status: 409, message: '只能给今天的任务（或还没到截止日期的任务）计时' };
    return row;
  }

  goalForTimer(id) {
    const row = this.periodsService.getTask(id);
    if (!row) throw { status: 404, message: '长期任务不存在' };
    if (!row.track_time) throw { status: 409, message: '这项任务不记录用时' };
    const status = this.periodsService.describeTask(row).status;
    if (status === 'completed') throw { status: 409, message: '这项任务已经完成了' };
    if (status !== 'active') throw { status: 409, message: '不在任务日期内' };
    return row;
  }

  // Folds the running part of every timer of the child into its elapsed time.
  pauseRunning(childId, now) {
    this.homeworkStudyService?.pauseChild(childId, now);
    for (const table of ['daily_tasks', 'period_tasks']) {
      const pause = this.db.prepare(`UPDATE ${table} SET timer_elapsed_seconds = ?, timer_started_at = NULL WHERE id = ?`);
      for (const row of this.db.prepare(`SELECT id, timer_started_at, timer_elapsed_seconds FROM ${table} WHERE child_id = ? AND timer_started_at IS NOT NULL`).all(childId)) {
        pause.run(timerSeconds(row, now), row.id);
      }
    }
  }

  // action: start, pause or reset; kind: task (a daily task) or goal (a long-term task).
  apply(kind, id, action) {
    const spec = this.kinds[kind];
    if (!spec || !['start', 'pause', 'reset'].includes(action)) throw { status: 404, message: 'Not found' };
    if (kind === 'task') {
      const row = spec.load(id);
      if (row.homework_legacy_seconds !== null) {
        if (action === 'reset') throw { status: 409, message: '请在学习记录中结束或更正本次用时，已保存记录不能清零' };
        if (action === 'start') this.taskStudyService.start(id);
        else {
          const active = this.db.prepare('SELECT id FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(id);
          if (active) this.taskStudyService.pauseSession(id, active.id);
        }
        return spec.describe(row);
      }
    }
    let row;
    this.db.transaction(() => {
      row = spec.load(id);
      const now = Date.now();
      if (action === 'start') {
        if (row.timer_started_at) return;
        this.pauseRunning(row.child_id, now);
        this.db.prepare(`UPDATE ${spec.table} SET timer_started_at = ? WHERE id = ?`).run(new Date(now).toISOString(), row.id);
      } else if (action === 'pause') {
        if (row.timer_started_at) this.db.prepare(`UPDATE ${spec.table} SET timer_elapsed_seconds = ?, timer_started_at = NULL WHERE id = ?`).run(timerSeconds(row, now), row.id);
      } else {
        this.db.prepare(`UPDATE ${spec.table} SET timer_elapsed_seconds = 0, timer_started_at = NULL WHERE id = ?`).run(row.id);
      }
    })();
    return spec.describe(row);
  }
}

module.exports = TimersService;
