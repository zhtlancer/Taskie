const { generateId } = require('../utils/crypto');
const { getTodayDate, getDateRangeList, parseDate, shiftDate } = require('../utils/date');
const { completedOn } = require('../utils/goals');
const { cancelPendingSkips } = require('../utils/skips');
const { describeTimer, resolveDuration, timerSeconds, validateDuration, validateTiming } = require('../utils/timer');

const MODES = ['check', 'progress'];
const INPUT_MODES = ['increment', 'position'];

function validateDate(value, label) {
  try {
    parseDate(value);
  } catch {
    throw { status: 400, message: `${label}必须为 YYYY-MM-DD` };
  }
}

// Holiday periods and long-term tasks, per child.
//
// During a holiday period the parent can pause some daily and weekly templates. Long-term tasks
// (stored in period_tasks) are finished over many days, such as reading a 200-page book or holiday
// homework: either checked off once, or logged as progress towards a total. Progress is entered
// as the amount done ("increment") or as the page reached ("position"), earns points per unit plus
// an optional bonus on completion, and with daily_required logging becomes a required task each
// day. A task either stands alone with its own dates (no end date means no deadline) or belongs to
// a holiday period, whose dates it follows.
class PeriodsService {
  constructor(db, rewardsService, tasksService) {
    this.db = db;
    this.rewardsService = rewardsService;
    this.tasksService = tasksService;
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
      tasks: tasks.map(task => this.describeTask(task, today))
    };
  }

  // A holiday may be set on past days too, to excuse them; calendar changes go through changeCalendar.
  createPeriod(childId, body) {
    this.requireChild(childId);
    const fields = this.validatePeriod(childId, body);
    const id = generateId();
    this.db.transaction(() => this.changeCalendar(childId, () => {
      this.db.prepare('INSERT INTO periods (id, child_id, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, childId, fields.name, fields.start_date, fields.end_date, new Date().toISOString());
      this.setPausedTemplates(id, fields.paused_template_ids ?? []);
    }))();
    return this.describePeriod(this.getPeriod(id));
  }

  updatePeriod(id, body) {
    const existing = this.getPeriod(id);
    if (!existing) throw { status: 404, message: '假期不存在' };
    const fields = this.validatePeriod(existing.child_id, { ...existing, ...body }, id);
    this.db.transaction(() => this.changeCalendar(existing.child_id, () => {
      this.db.prepare('UPDATE periods SET name = ?, start_date = ?, end_date = ? WHERE id = ?')
        .run(fields.name, fields.start_date, fields.end_date, id);
      // Holiday tasks follow their period's dates.
      this.db.prepare('UPDATE period_tasks SET start_date = ?, end_date = ? WHERE period_id = ?')
        .run(fields.start_date, fields.end_date, id);
      for (const task of this.db.prepare('SELECT * FROM period_tasks WHERE period_id = ?').all(id)) this.prunePendingDailyRows(task);
      if (body.paused_template_ids !== undefined) this.setPausedTemplates(id, fields.paused_template_ids);
    }))();
    return this.describePeriod(this.getPeriod(id));
  }

  // Points already earned in the period stay with the child (point_logs keep them, unlinked).
  deletePeriod(id) {
    const existing = this.getPeriod(id);
    if (!existing) throw { status: 404, message: '假期不存在' };
    this.db.transaction(() => this.changeCalendar(existing.child_id, () => {
      for (const { id: taskId } of this.db.prepare('SELECT id FROM period_tasks WHERE period_id = ?').all(id)) this.removePendingDailyRows(taskId);
      this.db.prepare('DELETE FROM periods WHERE id = ?').run(id);
    }))();
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

  // --- Make-up school days (调休上学日) ---

  listMakeupDays(childId) {
    this.requireChild(childId);
    return this.db.prepare('SELECT * FROM makeup_days WHERE child_id = ? ORDER BY date DESC').all(childId);
  }

  // A holiday or make-up day moves the end of a break, so earlier tasks waiting it out must not
  // have their deadline cross today (see TasksService.guardCarryDeadlines).
  changeCalendar(childId, change) {
    return this.tasksService ? this.tasksService.guardCarryDeadlines(childId, change) : change();
  }

  // A day the child goes to school following another weekday's tasks and timetable. Past days
  // are recorded history, so make-up days are set and removed from today on only.
  createMakeupDay(childId, { date, acts_as, note = null }) {
    this.requireChild(childId);
    validateDate(date, '日期');
    if (date < getTodayDate()) throw { status: 400, message: '只能设置今天及以后的调休上学日' };
    if (!Number.isInteger(acts_as) || acts_as < 0 || acts_as > 6) throw { status: 400, message: '请选择按周几上课' };
    if (note !== null && (typeof note !== 'string' || note.trim().length > 30)) throw { status: 400, message: '备注不超过 30 个字' };
    if (this.db.prepare('SELECT 1 FROM makeup_days WHERE child_id = ? AND date = ?').get(childId, date)) {
      throw { status: 409, message: '这天已经设为调休上学日' };
    }
    const id = generateId();
    this.db.transaction(() => this.changeCalendar(childId, () => {
      this.db.prepare('INSERT INTO makeup_days (id, child_id, date, acts_as, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, childId, date, acts_as, note?.trim() || null, new Date().toISOString());
      this.tasksService?.reconcileCalendarDay(childId, date);
    }))();
    return this.db.prepare('SELECT * FROM makeup_days WHERE id = ?').get(id);
  }

  deleteMakeupDay(id) {
    const existing = this.db.prepare('SELECT * FROM makeup_days WHERE id = ?').get(id);
    if (!existing) throw { status: 404, message: '调休上学日不存在' };
    if (existing.date < getTodayDate()) throw { status: 400, message: '过去的调休上学日不能删除' };
    this.db.transaction(() => this.changeCalendar(existing.child_id, () => {
      this.db.prepare('DELETE FROM makeup_days WHERE id = ?').run(id);
      this.tasksService?.reconcileCalendarDay(existing.child_id, existing.date);
    }))();
    return { success: true, id };
  }

  // --- Long-term tasks ---

  getTask(id) {
    return this.db.prepare('SELECT * FROM period_tasks WHERE id = ?').get(id) || null;
  }

  // Every long-term task of a child, standalone and holiday ones, newest first.
  listGoals(childId, today = getTodayDate()) {
    this.requireChild(childId);
    return this.db.prepare(`
      SELECT t.*, p.name AS period_name FROM period_tasks t LEFT JOIN periods p ON p.id = t.period_id
      WHERE t.child_id = ? ORDER BY t.start_date DESC, t.created_at DESC
    `).all(childId).map(task => this.describeTask(task, today));
  }

  // Progress so far and pacing. With a deadline, what is left is spread over the days remaining
  // (today included); without one, the finish date is estimated from the last 7 days' pace.
  describeTask(task, today = getTodayDate()) {
    const logs = this.db.prepare('SELECT id, amount, position, date, created_at, duration_seconds, duration_source FROM period_task_logs WHERE period_task_id = ? ORDER BY date DESC, created_at DESC, rowid DESC')
      .all(task.id);
    const latest = this.db.prepare('SELECT id FROM period_task_logs WHERE period_task_id = ? ORDER BY rowid DESC LIMIT 1').get(task.id);
    const undoInOrder = Boolean(task.completed_at) || logs.some(log => log.position !== null);
    const done = Math.min(task.total_amount, logs.reduce((sum, log) => sum + log.amount, 0));
    const todayAmount = logs.filter(log => log.date === today).reduce((sum, log) => sum + log.amount, 0);
    const remaining = task.total_amount - done;
    const finishedOn = completedOn(task, logs[0]?.date);
    const status = finishedOn ? 'completed' : today < task.start_date ? 'upcoming' : task.end_date && today > task.end_date ? 'ended' : 'active';

    let daysLeft = null, suggestedToday = null, recentRate = null, estimatedFinish = null;
    if (status === 'active' || status === 'upcoming') {
      if (task.end_date) {
        daysLeft = (parseDate(task.end_date) - parseDate(today < task.start_date ? task.start_date : today)) / 86400000 + 1;
        suggestedToday = Math.max(0, Math.ceil((remaining + todayAmount) / daysLeft) - todayAmount);
      } else if (status === 'active') {
        const since = [task.start_date, shiftDate(today, -6)].sort().at(-1);
        const days = getDateRangeList(since, today).length;
        const recent = logs.filter(log => log.date >= since).reduce((sum, log) => sum + log.amount, 0);
        if (recent > 0) {
          recentRate = Number((recent / days).toFixed(1));
          // Today still counts as a reading day until something is logged; then the rest starts tomorrow.
          const daysNeeded = Math.ceil(remaining / (recent / days));
          estimatedFinish = shiftDate(today, todayAmount > 0 ? daysNeeded : daysNeeded - 1);
        }
      }
    }
    return {
      ...task,
      ...describeTimer(task),
      daily_required: Boolean(task.daily_required),
      status,
      done_amount: done,
      remaining_amount: remaining,
      is_completed: status === 'completed',
      completed_on: finishedOn,
      today_amount: todayAmount,
      today_logged: logs.some(log => log.date === today),
      days_left: daysLeft,
      suggested_today: suggestedToday,
      recent_daily_rate: recentRate,
      estimated_finish_date: estimatedFinish,
      logs: logs.map(log => ({ ...log, can_undo: !undoInOrder || log.id === latest.id }))
    };
  }

  // A holiday task: its child and dates come from the period.
  createTask(periodId, body) {
    const period = this.getPeriod(periodId);
    if (!period) throw { status: 404, message: '假期不存在' };
    return this.insertTask({ ...this.validateTask(body), period_id: periodId, child_id: period.child_id, start_date: period.start_date, end_date: period.end_date });
  }

  // A standalone long-term task, starting today unless given; the end date (deadline) is optional.
  createGoal(childId, body) {
    this.requireChild(childId);
    return this.insertTask({ ...this.validateTask(body), ...this.validateGoalDates(body), period_id: null, child_id: childId });
  }

  insertTask(fields) {
    const id = generateId();
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO period_tasks (id, period_id, child_id, title, subject, mode, input_mode, total_amount, unit, points,
          completion_bonus, start_date, end_date, daily_required, completed_at, created_at, track_time, expected_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
        .run(id, fields.period_id, fields.child_id, fields.title, fields.subject, fields.mode, fields.input_mode, fields.total_amount, fields.unit,
          fields.points, fields.completion_bonus, fields.start_date, fields.end_date, fields.daily_required ? 1 : 0, new Date().toISOString(),
          fields.track_time ? 1 : 0, fields.expected_minutes);
      return this.describeTask(this.getTask(id));
    })();
  }

  updateTask(id, body) {
    const existing = this.getTask(id);
    if (!existing) throw { status: 404, message: '长期任务不存在' };
    const fields = this.validateTask({ ...existing, daily_required: Boolean(existing.daily_required), track_time: Boolean(existing.track_time), ...body });
    const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(id).done;
    if (fields.mode !== existing.mode && done > 0) throw { status: 409, message: '已有进度记录，不能更改完成方式' };
    // Changing the total of a finished task could award its completion bonus twice.
    if (existing.completed_at && fields.total_amount !== existing.total_amount) throw { status: 409, message: '任务已完成，不能修改总量；如需修改请先撤销最后一次进度' };
    if (fields.total_amount < done) throw { status: 400, message: `总量不能小于已完成的 ${done}${existing.unit || ''}` };
    if (!existing.completed_at && done > 0 && fields.total_amount === done) {
      throw { status: 400, message: '未完成任务的总量必须大于已记录进度，请通过记录剩余进度完成任务' };
    }
    // Holiday tasks keep their period's dates.
    const dates = existing.period_id ? existing : this.validateGoalDates({ start_date: existing.start_date, end_date: existing.end_date, ...body });
    return this.db.transaction(() => {
      // Turning timing off drops the timer.
      this.db.prepare(`UPDATE period_tasks SET title = ?, subject = ?, mode = ?, input_mode = ?, total_amount = ?, unit = ?, points = ?,
          completion_bonus = ?, start_date = ?, end_date = ?, daily_required = ?, track_time = ?, expected_minutes = ?,
          timer_started_at = CASE WHEN ? THEN timer_started_at END, timer_elapsed_seconds = CASE WHEN ? THEN timer_elapsed_seconds ELSE 0 END
        WHERE id = ?`)
        .run(fields.title, fields.subject, fields.mode, fields.input_mode, fields.total_amount, fields.unit, fields.points,
          fields.completion_bonus, dates.start_date, dates.end_date, fields.daily_required ? 1 : 0,
          fields.track_time ? 1 : 0, fields.expected_minutes, fields.track_time ? 1 : 0, fields.track_time ? 1 : 0, id);
      this.prunePendingDailyRows(this.getTask(id));
      return this.describeTask(this.getTask(id));
    })();
  }

  // Progress entries go with the task; the points they earned stay with the child.
  deleteTask(id) {
    if (!this.getTask(id)) throw { status: 404, message: '长期任务不存在' };
    this.db.transaction(() => {
      this.removePendingDailyRows(id);
      this.db.prepare('DELETE FROM period_tasks WHERE id = ?').run(id);
    })();
    return { success: true, id };
  }

  // Days already logged stay in history; days still waiting for an entry are dropped from today on.
  // Earlier pending rows are kept: history reads hide those the task no longer requires, so a
  // change that excuses past days can be undone without losing them.
  removePendingDailyRows(taskId) {
    this.db.prepare('DELETE FROM daily_tasks WHERE goal_id = ? AND is_completed = 0 AND date >= ?').run(taskId, getTodayDate());
  }

  prunePendingDailyRows(task) {
    if (!task.daily_required) return this.removePendingDailyRows(task.id);
    const lastDate = this.db.prepare('SELECT MAX(date) AS date FROM period_task_logs WHERE period_task_id = ?').get(task.id).date;
    const finishedOn = completedOn(task, lastDate);
    this.db.prepare(`DELETE FROM daily_tasks WHERE goal_id = ? AND is_completed = 0 AND date >= ?
      AND (date < ? OR (? IS NOT NULL AND date > ?) OR (? IS NOT NULL AND date > ?))`)
      .run(task.id, getTodayDate(), task.start_date, task.end_date, task.end_date, finishedOn, finishedOn);
  }

  validateTask({ title, subject, mode = 'check', input_mode = 'increment', total_amount, unit, points = 0, completion_bonus = 0, daily_required = false, track_time, expected_minutes }) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 50) throw { status: 400, message: '任务名称不能为空，且不超过 50 个字' };
    if (typeof subject !== 'string' || !subject.trim()) throw { status: 400, message: '请选择学科' };
    if (!MODES.includes(mode)) throw { status: 400, message: '完成方式无效' };
    if (!INPUT_MODES.includes(input_mode)) throw { status: 400, message: '记录方式无效' };
    if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw { status: 400, message: '积分必须为 0 至 10000 的整数' };
    if (!Number.isSafeInteger(completion_bonus) || completion_bonus < 0 || completion_bonus > 100000) throw { status: 400, message: '完成奖励必须为 0 至 100000 的整数' };
    if (typeof daily_required !== 'boolean') throw { status: 400, message: '“每天要记录”设置无效' };
    const common = { title: title.trim(), subject: subject.trim(), mode, points, completion_bonus, daily_required, ...validateTiming({ track_time, expected_minutes }) };
    if (mode === 'check') return { ...common, input_mode: 'increment', total_amount: 1, unit: null };
    if (!Number.isSafeInteger(total_amount) || total_amount < 1 || total_amount > 100000) throw { status: 400, message: '总量必须为 1 至 100000 的整数' };
    if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 10) throw { status: 400, message: '请填写单位，如 页、篇、次' };
    return { ...common, input_mode, total_amount, unit: unit.trim() };
  }

  validateGoalDates({ start_date, end_date }) {
    const start = start_date ?? getTodayDate();
    validateDate(start, '开始日期');
    const end = end_date || null;
    if (end !== null) {
      validateDate(end, '截止日期');
      if (end < start) throw { status: 400, message: '截止日期不能早于开始日期' };
    }
    return { start_date: start, end_date: end };
  }

  // --- Progress ---

  // Children log progress for today only; parents may also backfill earlier days of the task.
  // Position entries give the page reached; the amount logged is how far that is past the progress
  // so far. Reaching the total completes the task and awards its bonus with that entry. A timed task's
  // entry for today keeps the session's duration and starts the timer over. Historical entries only
  // keep a duration entered by hand, leaving the current session alone unless the whole task finishes.
  // A request_id makes the entry idempotent: retrying after a lost response returns the first entry
  // instead of logging (and rewarding) the same progress twice.
  logProgress(taskId, { amount, position, date, duration_seconds, request_id: requestId }, { role }) {
    const task = this.getTask(taskId);
    if (!task) throw { status: 404, message: '长期任务不存在' };
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))) throw { status: 400, message: '记录标识无效' };
    const fingerprint = JSON.stringify({ date: date ?? null, amount: task.mode === 'check' ? null : task.input_mode === 'position' ? position : amount, duration: duration_seconds === undefined ? 'auto' : duration_seconds });
    const replayed = requestId && this.db.prepare('SELECT * FROM period_task_logs WHERE id = ?').get(requestId);
    if (replayed) {
      const same = replayed.period_task_id === taskId && (replayed.request_fingerprint !== null
        ? replayed.request_fingerprint === fingerprint
        : (date === undefined || replayed.date === date) && (duration_seconds === undefined || replayed.duration_seconds === duration_seconds) &&
          (task.mode === 'check' || (task.input_mode === 'position' ? replayed.position === position : replayed.amount === amount)));
      if (!same) throw { status: 409, message: '记录标识已使用' };
      const earned = this.db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM point_logs WHERE period_log_id = ?').get(requestId).points;
      return {
        success: true,
        log_id: requestId,
        points_earned: earned,
        completion_bonus: Math.max(0, earned - task.points * replayed.amount),
        task: this.describeTask(task),
        new_badges: []
      };
    }
    const today = getTodayDate();
    const logDate = date ?? today;
    if (role !== 'parent' && logDate !== today) throw { status: 403, message: '只能记录今天的进度' };
    validateDate(logDate, '日期');
    if (logDate < task.start_date || task.end_date && logDate > task.end_date) throw { status: 400, message: '不在任务日期内' };
    if (logDate > today) throw { status: 400, message: '不能记录未来的进度' };
    const byPosition = task.mode === 'progress' && task.input_mode === 'position';
    const isToday = logDate === today;
    const duration = task.track_time
      ? resolveDuration(task, isToday ? duration_seconds : duration_seconds ?? null)
      : { seconds: null, source: null };

    let logId, logAmount, bonus = 0, newBadges = [];
    this.db.transaction(() => {
      const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(taskId).done;
      const remaining = task.total_amount - done;
      if (remaining <= 0) throw { status: 409, message: '这项任务已经完成了' };
      if (task.mode === 'check') logAmount = 1;
      else if (byPosition) {
        if (!Number.isSafeInteger(position) || position <= done) throw { status: 400, message: `请填写读到的位置，需大于上次的第 ${done} ${task.unit}` };
        if (position > task.total_amount) throw { status: 400, message: `最多到第 ${task.total_amount} ${task.unit}` };
        logAmount = position - done;
      } else {
        logAmount = amount;
        if (!Number.isSafeInteger(logAmount) || logAmount < 1) throw { status: 400, message: '进度必须为正整数' };
        if (logAmount > remaining) throw { status: 400, message: `最多还能记录 ${remaining}${task.unit || ''}` };
      }
      logId = requestId || generateId();
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO period_task_logs (id, period_task_id, amount, position, date, created_at, duration_seconds, duration_source, request_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(logId, taskId, logAmount, byPosition ? done + logAmount : null, logDate, now, duration.seconds, duration.source, requestId ? fingerprint : null);
      if (task.track_time) {
        if (isToday) this.db.prepare('UPDATE period_tasks SET timer_started_at = NULL, timer_elapsed_seconds = 0 WHERE id = ?').run(taskId);
        else if (logAmount === remaining && task.timer_started_at) {
          // A completed task cannot keep a hidden timer running. Preserve the session for a possible undo.
          this.db.prepare('UPDATE period_tasks SET timer_started_at = NULL, timer_elapsed_seconds = ? WHERE id = ?').run(timerSeconds(task), taskId);
        }
      }
      const award = (points, title) => this.db.prepare(`INSERT INTO point_logs
        (id, child_id, daily_task_id, points, earned_at, period_log_id, activity_date, activity_title) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`)
        .run(generateId(), task.child_id, points, now, logId, logDate, title);
      if (task.points > 0) {
        const title = task.mode === 'check' ? task.title
          : byPosition ? `${task.title} 读到第 ${done + logAmount} ${task.unit}` : `${task.title} ${logAmount}${task.unit}`;
        award(task.points * logAmount, title);
      }
      if (logAmount === remaining) {
        this.db.prepare('UPDATE period_tasks SET completed_at = ? WHERE id = ?').run(now, taskId);
        if (task.completion_bonus > 0) {
          bonus = task.completion_bonus;
          award(bonus, `${task.title} 完成奖励`);
        }
      }
      this.markDailyRow(task, logDate);
      this.prunePendingDailyRows(this.getTask(taskId));
      if (this.rewardsService) newBadges = this.rewardsService.checkAndUnlockBadges(task.child_id);
    })();
    return {
      success: true,
      log_id: logId,
      points_earned: task.points * logAmount + bonus,
      completion_bonus: bonus,
      task: this.describeTask(this.getTask(taskId)),
      new_badges: newBadges
    };
  }

  // Undoing an entry takes back its points (and the completion bonus if it finished the task).
  // Children may only undo today's entries, and not once those points were spent on rewards;
  // parents can correct past or spent entries. Position entries and completed tasks must be undone
  // newest first, so later positions and their completion rewards cannot survive an earlier undo.
  deleteLog(logId, { role }) {
    const log = this.db.prepare(`
      SELECT l.*, t.child_id FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id WHERE l.id = ?
    `).get(logId);
    if (!log) throw { status: 404, message: '进度记录不存在' };
    if (role !== 'parent') {
      if (log.date !== getTodayDate()) throw { status: 403, message: '只能撤销今天的进度' };
      const earned = this.db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM point_logs WHERE period_log_id = ?').get(logId).points;
      if (this.rewardsService && this.rewardsService.getAvailablePoints(log.child_id) < earned) {
        throw { status: 409, message: '这次进度的积分已用于兑换奖励，不能撤销' };
      }
    }
    const taskBefore = this.getTask(log.period_task_id);
    const latest = this.db.prepare('SELECT id FROM period_task_logs WHERE period_task_id = ? ORDER BY rowid DESC LIMIT 1').get(log.period_task_id);
    const hasPositions = this.db.prepare('SELECT 1 FROM period_task_logs WHERE period_task_id = ? AND position IS NOT NULL LIMIT 1').get(log.period_task_id);
    if ((taskBefore.completed_at || hasPositions) && latest.id !== logId) {
      throw { status: 409, message: '请先撤销后续进度，再撤销这条记录' };
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM point_logs WHERE period_log_id = ?').run(logId);
      this.db.prepare('DELETE FROM period_task_logs WHERE id = ?').run(logId);
      const task = this.getTask(log.period_task_id);
      const done = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS done FROM period_task_logs WHERE period_task_id = ?').get(task.id).done;
      if (done < task.total_amount) this.db.prepare('UPDATE period_tasks SET completed_at = NULL WHERE id = ?').run(task.id);
      this.markDailyRow(task, log.date);
      this.prunePendingDailyRows(this.getTask(task.id));
    })();
    return { success: true, task: this.describeTask(this.getTask(log.period_task_id)) };
  }

  // Correcting or clearing an entry's duration; children only for today's entries.
  setLogDuration(logId, durationSeconds, { role }) {
    const log = this.db.prepare(`
      SELECT l.*, t.track_time FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id WHERE l.id = ?
    `).get(logId);
    if (!log) throw { status: 404, message: '进度记录不存在' };
    if (!log.track_time) throw { status: 409, message: '这项任务不记录用时' };
    if (role !== 'parent' && log.date !== getTodayDate()) throw { status: 403, message: '只能修改今天的用时' };
    const seconds = validateDuration(durationSeconds);
    this.db.prepare('UPDATE period_task_logs SET duration_seconds = ?, duration_source = ? WHERE id = ?').run(seconds, seconds === null ? null : 'manual', logId);
    return { success: true, task: this.describeTask(this.getTask(log.period_task_id)) };
  }

  // Keeps a daily-required task's row for that day in step with whether progress was logged then.
  markDailyRow(task, date) {
    if (!task.daily_required) return;
    const logged = Boolean(this.db.prepare('SELECT 1 FROM period_task_logs WHERE period_task_id = ? AND date = ?').get(task.id, date));
    const row = this.db.prepare('SELECT id FROM daily_tasks WHERE goal_id = ? AND date = ?').get(task.id, date);
    const completedAt = logged ? new Date().toISOString() : null;
    if (row) this.db.prepare('UPDATE daily_tasks SET is_completed = ?, completed_at = ? WHERE id = ?').run(logged ? 1 : 0, completedAt, row.id);
    else if (logged) insertGoalDailyRow(this.db, task, date, true);
    if (row && logged) cancelPendingSkips(this.db, row.id);
  }

  requireChild(childId) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw { status: 404, message: 'Child not found' };
  }
}

// The daily row for a daily-required long-term task. It earns no points itself (progress entries
// do); it only makes logging that day a required task.
function insertGoalDailyRow(db, task, date, completed = false) {
  db.prepare(`INSERT INTO daily_tasks (id, child_id, template_id, title, subject, points, date, is_completed, completed_at,
      schedule_type, weekly_target_times, origin, goal_id)
    VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?, 'fixed_days', NULL, 'goal', ?)`)
    .run(generateId(), task.child_id, task.title, task.subject, date, completed ? 1 : 0, completed ? new Date().toISOString() : null, task.id);
}

module.exports = PeriodsService;
module.exports.insertGoalDailyRow = insertGoalDailyRow;
