const { generateId } = require('../utils/crypto');
const { insertGoalDailyRow } = require('./periods.service');
const { formatDate, getTodayDate, getDayOfWeek, getWeekRange, getDateRangeList, parseDate, shiftDate } = require('../utils/date');
const { completedOn } = require('../utils/goals');
const { cancelPendingSkips } = require('../utils/skips');
const { describeTimer, resolveDuration, timerSeconds, validateDuration, validateTiming } = require('../utils/timer');

function normalizeDaysOfWeek(days) {
  if (Array.isArray(days)) {
    return [...new Set(days.map(d => parseInt(d, 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6))];
  }
  if (typeof days === 'string') {
    try {
      const parsed = JSON.parse(days);
      if (Array.isArray(parsed)) {
        return normalizeDaysOfWeek(parsed);
      }
    } catch {
      return normalizeDaysOfWeek(days.split(','));
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

// Weekly tasks may be limited to some weekdays (e.g. a weekend task); the target must fit them.
function validateWeeklyDays(scheduleType, target, days) {
  if (days.length === 0) throw { status: 400, message: '请至少选择一天' };
  if (scheduleType === 'weekly_times' && target > days.length) {
    throw { status: 400, message: '每周目标次数不能超过可完成的天数' };
  }
}

// A task a parent let the child skip that day. Completing it anyway wins over the skip.
const isSkippedRow = row => Boolean(row.skipped_at) && !row.is_completed;

// Weekly tasks whose target is already met (skipped times count towards it) are hidden unless
// completed or skipped that day.
function isActiveTask(task) {
  return task.schedule_type !== 'weekly_times' || task.is_completed || task.is_skipped ||
    task.weekly_completed_times + (task.weekly_skipped_times || 0) < task.weekly_target_times;
}

// Optional weekly tasks only count once completed and skipped tasks never count, so neither
// breaks a day, and a day with nothing completed is never all done.
function summarizeDay(tasks) {
  const active = tasks.filter(isActiveTask);
  const counted = active.filter(task => !task.is_skipped && (!task.is_optional || task.is_completed));
  const completed = counted.filter(task => task.is_completed).length;
  return { total: counted.length, completed, skipped: active.filter(task => task.is_skipped).length,
    all_done: completed > 0 && completed === counted.length };
}

class TasksService {
  constructor(db, rewardsService) {
    this.db = db;
    this.rewardsService = rewardsService;
  }

  // --- Task Templates ---

  listTemplates() {
    const rows = this.db.prepare(`
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all, track_time, expected_minutes
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
      track_time: Boolean(row.track_time),
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
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all, track_time, expected_minutes
      FROM task_templates
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    const childIds = this.db.prepare('SELECT child_id FROM template_children WHERE template_id = ?').all(id).map(r => r.child_id);
    return this.describeTemplate(row, childIds);
  }

  createTemplate({ title, subject, days_of_week, points, schedule_type = 'fixed_days', weekly_target_times = null, child_ids = null, track_time, expected_minutes }) {
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
    const timing = validateTiming({ track_time, expected_minutes });
    const id = generateId();
    const daysArr = normalizeDaysOfWeek(days_of_week);
    validateWeeklyDays(schedule_type, weekly_target_times, daysArr);
    const pts = typeof points === 'number' && points >= 0 ? points : 10;
    const createdAt = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, track_time, expected_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title.trim(), subject.trim(), JSON.stringify(daysArr), pts, createdAt, schedule_type, schedule_type === 'weekly_times' ? weekly_target_times : null,
        timing.track_time ? 1 : 0, timing.expected_minutes);
      this.setTemplateChildren(id, childIds);
    })();

    return this.getTemplate(id);
  }

  updateTemplate(id, { title, subject, days_of_week, points, schedule_type, weekly_target_times, child_ids, track_time, expected_minutes }) {
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
    validateWeeklyDays(schedule, target, newDays);
    const childIds = child_ids === undefined ? undefined : normalizeChildIds(child_ids);
    const timing = validateTiming({
      track_time: track_time ?? existing.track_time,
      expected_minutes: expected_minutes === undefined ? existing.expected_minutes : expected_minutes
    });
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE task_templates
        SET title = ?, subject = ?, days_of_week = ?, points = ?, schedule_type = ?, weekly_target_times = ?, track_time = ?, expected_minutes = ?
        WHERE id = ?
      `).run(newTitle, newSubject, JSON.stringify(newDays), newPoints, schedule, schedule === 'weekly_times' ? target : null,
        timing.track_time ? 1 : 0, timing.expected_minutes, id);
      if (childIds !== undefined) this.setTemplateChildren(id, childIds);
      // Today's unfinished tasks follow the timing settings at once; turning timing off drops their timer.
      this.db.prepare(`UPDATE daily_tasks SET track_time = ?, expected_minutes = ?,
          timer_started_at = CASE WHEN ? THEN timer_started_at END, timer_elapsed_seconds = CASE WHEN ? THEN timer_elapsed_seconds ELSE 0 END
        WHERE COALESCE(source_template_id, template_id) = ? AND date >= ? AND is_completed = 0`)
        .run(timing.track_time ? 1 : 0, timing.expected_minutes, timing.track_time ? 1 : 0, timing.track_time ? 1 : 0, id, getTodayDate());
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
    const schedule = this.scheduleFor(childId);
    const matching = schedule.assigned.filter(t => schedule.allowedOn(t.id, date));
    const classLessons = this.classTasksOn(childId)(date);
    this.db.transaction(() => {
      if (date === getTodayDate()) {
        this.removeUnassignedTodayTasks();
        // Pausing a template for a holiday drops today's pending task; completed ones stay.
        const remove = this.db.prepare('DELETE FROM daily_tasks WHERE id = ?');
        for (const row of this.db.prepare('SELECT id, COALESCE(source_template_id, template_id) AS template FROM daily_tasks WHERE child_id = ? AND date = ? AND is_completed = 0').all(childId, date)) {
          if (row.template && schedule.isPaused(row.template, date)) remove.run(row.id);
        }
      }
      const exists = this.db.prepare('SELECT id FROM daily_tasks WHERE child_id = ? AND date = ? AND template_id = ?');
      const insert = this.db.prepare(`INSERT INTO daily_tasks
        (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times, source_template_id, template_created_at,
          track_time, expected_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`);
      for (const t of matching) {
        if (!exists.get(childId, date, t.id) && (t.schedule_type !== 'weekly_times' || this.weeklyCount(childId, t.id, date) < t.weekly_target_times)) {
          insert.run(generateId(), childId, t.id, t.title, t.subject, t.points, date, t.schedule_type, t.weekly_target_times, t.id, t.created_at,
            t.track_time ? 1 : 0, t.expected_minutes);
        }
      }
      const goalRow = this.db.prepare('SELECT id FROM daily_tasks WHERE goal_id = ? AND date = ?');
      const loggedOn = this.db.prepare('SELECT 1 FROM period_task_logs WHERE period_task_id = ? AND date = ?');
      for (const goal of this.dailyGoalsOn(childId, date)) {
        if (!goalRow.get(goal.id, date)) insertGoalDailyRow(this.db, goal, date, Boolean(loggedOn.get(goal.id, date)));
      }
      // An outside class that makes check-ins is a task on each day its lesson takes place.
      const classRow = this.db.prepare('SELECT id FROM daily_tasks WHERE child_id = ? AND class_id = ? AND date = ?');
      const insertClass = this.db.prepare(`INSERT INTO daily_tasks
        (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times, origin, class_id)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 0, NULL, 'fixed_days', NULL, 'class', ?)`);
      for (const lesson of classLessons) {
        if (!classRow.get(childId, lesson.class_id, date)) insertClass.run(generateId(), childId, lesson.title, lesson.subject, lesson.points, date, lesson.class_id);
      }
    })();
    // The latest skip request tells the child whether one is waiting or was turned down.
    const latestSkip = this.db.prepare('SELECT id, status, reason FROM task_skip_requests WHERE daily_task_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1');
    // A class check-in carries its lesson's time and place for the card.
    const lessonOf = new Map(this.scheduleService ? this.scheduleService.outsideLessons(childId)(date).map(l => [l.class_id, l]) : []);
    return this.describeTasksBetween(childId, date, date).filter(isActiveTask)
      .map(task => {
        const lesson = task.class_id && lessonOf.get(task.class_id);
        return { ...task, skip_request: latestSkip.get(task.id) || null,
          class_lesson: lesson ? { start_time: lesson.start_time, end_time: lesson.end_time, location: lesson.location, institution: lesson.institution } : null };
      });
  }

  // Outside-class lessons that are check-in tasks, per date (none without the schedule service).
  classTasksOn(childId) {
    return this.scheduleService ? this.scheduleService.classTaskSchedule(childId) : () => [];
  }

  // Times a weekly task was done or skipped this week: both use up its weekly target.
  weeklyCount(childId, templateId, date) {
    const { startDate, endDate } = getWeekRange(date);
    return this.db.prepare("SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ? AND COALESCE(source_template_id, template_id) = ? AND schedule_type = 'weekly_times' AND date BETWEEN ? AND ? AND (is_completed = 1 OR skipped_at IS NOT NULL)")
      .get(childId, templateId, startDate, endDate).n;
  }

  describeTask(t) {
    return this.describeTasksBetween(t.child_id, t.date, t.date, { includePaused: true }).find(task => task.id === t.id);
  }

  // Describes a child's tasks between two dates with weekly progress, using one query over
  // the surrounding weeks. A weekly task is optional on a day while the times still needed
  // (counting only earlier days, so past days never change) are fewer than the days left
  // in the week including that day; once there is no slack it is required that day. A skipped
  // time takes one off the target, so skipping on a day without slack still keeps the week whole.
  describeTasksBetween(childId, fromDate, toDate, { includePaused = false } = {}) {
    const weekStarts = new Map();
    const weekOf = date => {
      if (!weekStarts.has(date)) weekStarts.set(date, getWeekRange(date).startDate);
      return weekStarts.get(date);
    };
    // Filter obsolete pending goal rows in this query, keeping history reads at a constant cost.
    const rows = this.db.prepare(`SELECT d.* FROM daily_tasks d WHERE d.child_id = ? AND d.date BETWEEN ? AND ?
      AND (d.is_completed = 1 OR d.goal_id IS NULL OR EXISTS (
        SELECT 1 FROM period_tasks g WHERE g.id = d.goal_id AND g.daily_required = 1
        AND g.start_date <= d.date AND (g.end_date IS NULL OR g.end_date >= d.date)
        AND (g.completed_at IS NULL OR d.date <= (SELECT MAX(date) FROM period_task_logs WHERE period_task_id = g.id))
      )) ORDER BY d.date, d.rowid`)
      .all(childId, weekOf(fromDate), getWeekRange(toDate).endDate);
    const sourceOf = row => row.source_template_id ?? row.template_id;
    const keyOf = row => `${weekOf(row.date)}|${sourceOf(row) ?? row.id}`;
    const schedule = this.scheduleFor(childId);
    const completions = new Map();
    const skips = new Map();
    for (const row of rows) {
      if (row.schedule_type !== 'weekly_times') continue;
      const dates = row.is_completed ? completions : isSkippedRow(row) ? skips : null;
      if (!dates) continue;
      if (!dates.has(keyOf(row))) dates.set(keyOf(row), []);
      dates.get(keyOf(row)).push(row.date);
    }

    return rows.filter(row => row.date >= fromDate && row.date <= toDate &&
      (includePaused || row.is_completed || !schedule.isPaused(sourceOf(row), row.date))).map(row => {
      const task = { ...row, is_completed: Boolean(row.is_completed), is_skipped: isSkippedRow(row), ...describeTimer(row) };
      if (row.schedule_type !== 'weekly_times') return { ...task, is_optional: false };
      const done = completions.get(keyOf(row)) || [];
      const skipped = skips.get(keyOf(row)) || [];
      const target = row.weekly_target_times || 1;
      const usedBefore = [...done, ...skipped].filter(date => date < row.date).length;
      // The task's own day plus the remaining days this week it may still be done.
      const daysLeft = 1 + schedule.availableDays(sourceOf(row), shiftDate(row.date, 1), getWeekRange(row.date).endDate);
      return {
        ...task,
        weekly_completed_times: done.length,
        weekly_skipped_times: skipped.length,
        weekly_remaining_times: Math.max(0, target - done.length - skipped.length),
        week_days_left: daysLeft,
        is_optional: target - usedBefore < daysLeft
      };
    });
  }

  // The templates that apply to a child and when each may be done: from the date it was created,
  // on its allowed weekdays, except while one of the child's holiday periods pauses it.
  scheduleFor(childId) {
    const child = this.db.prepare('SELECT created_at FROM children WHERE id = ?').get(childId);
    const sinceDate = iso => formatDate(new Date(iso));
    const templates = this.listTemplates().map(t => ({ ...t, since: sinceDate(t.created_at) }));
    const byId = new Map(templates.map(t => [t.id, t]));
    const pausedRanges = this.db.prepare(`
      SELECT p.start_date, p.end_date, pt.template_id FROM periods p
      JOIN period_paused_templates pt ON pt.period_id = p.id
      WHERE p.child_id = ?
    `).all(childId);
    const isPaused = (templateId, date) => pausedRanges.some(range =>
      range.template_id === templateId && range.start_date <= date && range.end_date >= date);
    // Deleted templates are unknown and treated as available every day.
    const allowedOn = (templateId, date) => {
      const template = byId.get(templateId);
      return !isPaused(templateId, date) && (!template || template.days_of_week.includes(getDayOfWeek(date)));
    };
    return {
      childSince: child ? sinceDate(child.created_at) : null,
      byId,
      assigned: templates.filter(t => t.child_ids === null || t.child_ids.includes(childId)),
      isPaused,
      allowedOn,
      availableDays: (templateId, from, to) => from > to ? 0 : getDateRangeList(from, to).filter(date => allowedOn(templateId, date)).length
    };
  }

  // Tells whether a date was a rest day for a child: nothing required was scheduled. Opened days
  // use their generated tasks (only flexible weekly ones means rest); unopened days are rest days
  // unless a fixed-day template, a weekly deadline, a daily long-term log or a class check-in applied.
  restDayChecker(childId, fromDate, toDate) {
    const schedule = this.scheduleFor(childId);
    const goalsOn = this.dailyGoalSchedule(childId);
    const classTasksOn = this.classTasksOn(childId);
    const byDate = new Map();
    const weeklyDone = new Map();
    const weeklyKey = (templateId, date) => `${getWeekRange(date).startDate}|${templateId}`;
    for (const task of this.describeTasksBetween(childId, getWeekRange(fromDate).startDate, toDate).filter(isActiveTask)) {
      if (!byDate.has(task.date)) byDate.set(task.date, []);
      byDate.get(task.date).push(task);
      if (task.schedule_type === 'weekly_times' && (task.is_completed || task.is_skipped)) {
        const key = weeklyKey(task.source_template_id ?? task.template_id, task.date);
        if (!weeklyDone.has(key)) weeklyDone.set(key, []);
        weeklyDone.get(key).push(task.date);
      }
    }
    // Skipped tasks were not required that day, so a day with everything skipped is a rest day.
    return date => {
      if (byDate.has(date)) return byDate.get(date).every(task => task.is_optional || task.is_skipped);
      if (!schedule.childSince || date < schedule.childSince) return true;
      if (goalsOn(date).length || classTasksOn(date).length) return false;
      return !schedule.assigned.some(t => {
        if (t.since > date || !schedule.allowedOn(t.id, date)) return false;
        if (t.schedule_type !== 'weekly_times') return true;
        const { startDate, endDate } = getWeekRange(date);
        const start = [startDate, schedule.childSince, t.since].sort().at(-1);
        const target = Math.min(t.weekly_target_times, schedule.availableDays(t.id, start, endDate));
        const doneBefore = (weeklyDone.get(weeklyKey(t.id, date)) || []).filter(day => day < date).length;
        return target - doneBefore >= schedule.availableDays(t.id, date, endDate);
      });
    };
  }

  // Long-term tasks whose progress must be logged on this date: daily-required, running then, and
  // not finished on an earlier day.
  dailyGoalsOn(childId, date) {
    return this.dailyGoalSchedule(childId)(date);
  }

  // Loads a child's daily-required long-term tasks once and answers, per date, which applied.
  dailyGoalSchedule(childId) {
    const goals = this.db.prepare(`SELECT t.*, (SELECT MAX(date) FROM period_task_logs WHERE period_task_id = t.id) AS last_progress_date
      FROM period_tasks t WHERE child_id = ? AND daily_required = 1`).all(childId)
      .map(goal => ({ ...goal, completedOn: completedOn(goal, goal.last_progress_date) }));
    return date => goals.filter(goal => goal.start_date <= date && (!goal.end_date || goal.end_date >= date) &&
      (!goal.completedOn || goal.completedOn >= date));
  }

  // --- One-off tasks ---

  // A one-off task a parent adds for one child on one day (e.g. homework assigned that day).
  // It is an ordinary daily task for that day: required, counted in all-done, history, weekly
  // completion and the streak, and checked off like any other.
  createAdhocTask(childId, { title, subject, points = 10, date, track_time, expected_minutes }) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw { status: 404, message: 'Child not found' };
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 50) throw { status: 400, message: '任务名称不能为空，且不超过 50 个字' };
    if (typeof subject !== 'string' || !subject.trim()) throw { status: 400, message: '请选择学科' };
    if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw { status: 400, message: '积分必须为 0 至 10000 的整数' };
    const timing = validateTiming({ track_time, expected_minutes });
    const taskDate = date ?? getTodayDate();
    try {
      parseDate(taskDate);
    } catch {
      throw { status: 400, message: '日期必须为 YYYY-MM-DD' };
    }
    const id = generateId();
    this.db.prepare(`INSERT INTO daily_tasks
      (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times, origin, track_time, expected_minutes)
      VALUES (?, ?, NULL, ?, ?, ?, ?, 0, NULL, 'fixed_days', NULL, 'adhoc', ?, ?)`)
      .run(id, childId, title.trim(), subject.trim(), points, taskDate, timing.track_time ? 1 : 0, timing.expected_minutes);
    return this.describeTask(this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id));
  }

  listAdhocTasks(childId, fromDate = getTodayDate()) {
    return this.db.prepare("SELECT * FROM daily_tasks WHERE child_id = ? AND origin = 'adhoc' AND date >= ? ORDER BY date, rowid")
      .all(childId, fromDate).map(row => ({ ...row, is_completed: Boolean(row.is_completed) }));
  }

  // Removing a one-off task also removes the points it earned (its point log goes with it).
  deleteAdhocTask(id) {
    const task = this.db.prepare('SELECT origin FROM daily_tasks WHERE id = ?').get(id);
    if (!task || task.origin !== 'adhoc') throw { status: 404, message: '临时任务不存在' };
    this.db.prepare('DELETE FROM daily_tasks WHERE id = ?').run(id);
    return { success: true, id };
  }

  // A timed task records its duration: the one given (null for none), else what its timer counted.
  completeDailyTask(taskId, { duration_seconds } = {}) {
    const task = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    // A long-term task's daily row is completed by logging progress, never directly.
    if (task.origin === 'goal') throw { status: 409, message: '请在长期任务里记录今天的进度' };

    if (task.is_completed === 1) {
      return {
        success: true,
        task: this.describeTask(task),
        points_earned: 0,
        new_badges: []
      };
    }

    if (task.date > getTodayDate()) throw { status: 400, message: '不能提前完成未来的任务' };
    if (task.skipped_at) throw { status: 409, message: '这项任务今天已跳过，如需完成请家长先撤销跳过' };
    if (this.isUnassignedTodayTask(task)) throw { status: 409, message: '任务已取消分配，请刷新今日任务' };
    if (this.scheduleFor(task.child_id).isPaused(task.source_template_id ?? task.template_id, task.date)) {
      throw { status: 409, message: '假期中这项任务已暂停，请刷新今日任务' };
    }
    if (task.schedule_type === 'weekly_times' && this.weeklyCount(task.child_id, task.source_template_id ?? task.template_id, task.date) >= task.weekly_target_times) {
      throw { status: 409, message: '本周目标已完成' };
    }
    const duration = task.track_time ? resolveDuration(task, duration_seconds) : { seconds: null, source: null };
    const now = new Date().toISOString();
    let newBadges = [];

    const tx = this.db.transaction(() => {
      // 1. Update task to completed; doing it withdraws a skip request still waiting for a parent
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 1, completed_at = ?, duration_seconds = ?, duration_source = ?,
          timer_elapsed_seconds = ?, timer_started_at = NULL
        WHERE id = ?
      `).run(now, duration.seconds, duration.source, timerSeconds(task), taskId);
      cancelPendingSkips(this.db, taskId, now);

      // 2. Insert point log
      this.db.prepare(`
        INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at, activity_date, activity_title)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), task.child_id, task.id, task.points, now, task.date, task.title);

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
    if (task.origin === 'goal') throw { status: 409, message: '请在长期任务里撤销今天的进度' };

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
      // The timer keeps its time for when the task is done again; the recorded duration goes.
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 0, completed_at = NULL, duration_seconds = NULL, duration_source = NULL
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

  // Correcting or clearing the duration of a done timed task.
  setDuration(taskId, durationSeconds) {
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (!task) throw { status: 404, message: 'Daily task not found' };
    if (!task.track_time) throw { status: 409, message: '这项任务不记录用时' };
    if (!task.is_completed) throw { status: 409, message: '完成任务后才能填写用时' };
    const seconds = validateDuration(durationSeconds);
    this.db.prepare('UPDATE daily_tasks SET duration_seconds = ?, duration_source = ? WHERE id = ?').run(seconds, seconds === null ? null : 'manual', taskId);
    return { success: true, task: this.describeTask(this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId)) };
  }
}

module.exports = TasksService;
module.exports.isActiveTask = isActiveTask;
module.exports.summarizeDay = summarizeDay;
