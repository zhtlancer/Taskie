const { generateId } = require('../utils/crypto');
const { insertGoalDailyRow } = require('./periods.service');
const { formatDate, getTodayDate, getWeekRange, getDateRangeList, parseDate, shiftDate } = require('../utils/date');
const { completedOn } = require('../utils/goals');
const { cancelPendingSkips } = require('../utils/skips');
const { classLessonKey } = require('../utils/schedule');
const { describeTimer, resolveDuration, timerSeconds, validateDuration, validateTiming } = require('../utils/timer');
const { schoolCalendar, dueDateOf, MAX_CARRY_DAYS } = require('./calendar');

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

function validateExtraPolicy(schedule, { allow_extra = false, extra_points = 0, extra_reward_limit = 0 }) {
  if (typeof allow_extra !== 'boolean' || !Number.isSafeInteger(extra_points) || extra_points < 0 || extra_points > 10000 ||
    !Number.isSafeInteger(extra_reward_limit) || extra_reward_limit < 0 || extra_reward_limit > 7) {
    throw { status: 400, message: '额外完成设置无效：积分须为 0 至 10000，奖励次数须为 0 至 7' };
  }
  const enabled = schedule === 'weekly_times' && allow_extra;
  return { allow_extra: enabled ? 1 : 0, extra_points: enabled ? extra_points : 0, extra_reward_limit: enabled ? extra_reward_limit : 0 };
}

// A task a parent let the child skip that day. Completing it anyway wins over the skip.
const isSkippedRow = row => Boolean(row.skipped_at) && !row.is_completed;

// The fields every described task carries, before weekly and deadline details.
const describeRow = row => ({ ...row, is_completed: Boolean(row.is_completed), is_skipped: isSkippedRow(row), allow_extra: Boolean(row.allow_extra), is_extra_completion: Boolean(row.is_extra_completion), ...describeTimer(row) });

// Only tasks on fixed weekdays may wait out a break; weekly tasks are flexible already.
function validateCarryOver(carryOver, scheduleType) {
  if (typeof carryOver !== 'boolean' && carryOver !== 0 && carryOver !== 1) throw { status: 400, message: '“放假前的作业可以在假期里补完”设置无效' };
  return Boolean(carryOver) && scheduleType !== 'weekly_times';
}

// Weekly tasks whose target is met stay visible only when extra completions are enabled,
// or when already completed or skipped that day.
function isActiveTask(task) {
  return task.schedule_type !== 'weekly_times' || task.allow_extra || task.is_completed || task.is_skipped ||
    (task.weekly_target_completed_times ?? task.weekly_completed_times) + (task.weekly_skipped_times || 0) < task.weekly_target_times;
}

// Optional weekly tasks only count once completed and skipped tasks never count, so neither
// breaks a day, and a day with nothing completed is never all done.
function summarizeDay(tasks) {
  const active = tasks.filter(isActiveTask);
  const counted = active.filter(task => !task.is_extra && !task.is_skipped && (!task.is_optional || task.is_completed));
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
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all, track_time, expected_minutes, carry_over, allow_extra, extra_points, extra_reward_limit
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
      carry_over: Boolean(row.carry_over),
      allow_extra: Boolean(row.allow_extra),
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
      SELECT id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, assign_all, track_time, expected_minutes, carry_over, allow_extra, extra_points, extra_reward_limit
      FROM task_templates
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    const childIds = this.db.prepare('SELECT child_id FROM template_children WHERE template_id = ?').all(id).map(r => r.child_id);
    return this.describeTemplate(row, childIds);
  }

  createTemplate({ title, subject, days_of_week, points, schedule_type = 'fixed_days', weekly_target_times = null, child_ids = null, track_time, expected_minutes, carry_over = false, allow_extra = false, extra_points = 0, extra_reward_limit = 0 }) {
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
    const carry = validateCarryOver(carry_over, schedule_type);
    const extra = validateExtraPolicy(schedule_type, { allow_extra, extra_points, extra_reward_limit });
    const id = generateId();
    const daysArr = normalizeDaysOfWeek(days_of_week);
    validateWeeklyDays(schedule_type, weekly_target_times, daysArr);
    const pts = typeof points === 'number' && points >= 0 ? points : 10;
    const createdAt = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at, schedule_type, weekly_target_times, track_time, expected_minutes, carry_over, allow_extra, extra_points, extra_reward_limit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title.trim(), subject.trim(), JSON.stringify(daysArr), pts, createdAt, schedule_type, schedule_type === 'weekly_times' ? weekly_target_times : null,
        timing.track_time ? 1 : 0, timing.expected_minutes, carry ? 1 : 0, extra.allow_extra, extra.extra_points, extra.extra_reward_limit);
      this.setTemplateChildren(id, childIds);
    })();

    return this.getTemplate(id);
  }

  updateTemplate(id, { title, subject, days_of_week, points, schedule_type, weekly_target_times, child_ids, track_time, expected_minutes, carry_over, allow_extra, extra_points, extra_reward_limit }) {
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
    // A weekly task is already flexible, so switching to one turns carrying over off.
    const carry = validateCarryOver(carry_over ?? (schedule === 'weekly_times' ? false : existing.carry_over), schedule);
    const extra = validateExtraPolicy(schedule, {
      allow_extra: allow_extra === undefined ? existing.allow_extra : allow_extra,
      extra_points: extra_points === undefined ? existing.extra_points : extra_points,
      extra_reward_limit: extra_reward_limit === undefined ? existing.extra_reward_limit : extra_reward_limit
    });
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE task_templates
        SET title = ?, subject = ?, days_of_week = ?, points = ?, schedule_type = ?, weekly_target_times = ?, track_time = ?, expected_minutes = ?, carry_over = ?, allow_extra = ?, extra_points = ?, extra_reward_limit = ?
        WHERE id = ?
      `).run(newTitle, newSubject, JSON.stringify(newDays), newPoints, schedule, schedule === 'weekly_times' ? target : null,
        timing.track_time ? 1 : 0, timing.expected_minutes, carry ? 1 : 0, extra.allow_extra, extra.extra_points, extra.extra_reward_limit, id);
      // New policy affects only pending tasks from today onwards, never past snapshots or awards.
      this.db.prepare(`UPDATE daily_tasks SET allow_extra = ?, extra_points = ?, extra_reward_limit = ?
        WHERE COALESCE(source_template_id, template_id) = ? AND date >= ? AND is_completed = 0 AND schedule_type = 'weekly_times'`)
        .run(extra.allow_extra, extra.extra_points, extra.extra_reward_limit, id, getTodayDate());
      // Tasks still to do follow the carry-over setting, so a break that has begun is covered too.
      this.db.prepare('UPDATE daily_tasks SET carry_over = ? WHERE COALESCE(source_template_id, template_id) = ? AND is_completed = 0')
        .run(carry ? 1 : 0, id);
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

  // Calendar edits revoke only pending template tasks that no longer apply on that date.
  // Completed snapshots, one-off tasks and templates still matching keep their ids and timers.
  reconcileCalendarDay(childId, date, schedule = this.scheduleFor(childId)) {
    const remove = this.db.prepare('DELETE FROM daily_tasks WHERE id = ?');
    for (const row of this.db.prepare(`SELECT id, COALESCE(source_template_id, template_id) AS template
      FROM daily_tasks WHERE child_id = ? AND date = ? AND origin = 'template' AND is_completed = 0`).all(childId, date)) {
      if (row.template && !schedule.allowedOn(row.template, date)) remove.run(row.id);
    }
  }

  generateTemplateTasks(childId, date, templates) {
    const rows = new Map(this.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ? AND date = ? AND template_id IS NOT NULL')
      .all(childId, date).map(row => [row.template_id, row]));
    const insert = this.db.prepare(`INSERT INTO daily_tasks
      (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type,
        weekly_target_times, source_template_id, template_created_at, track_time, expected_minutes, carry_over, allow_extra, extra_points, extra_reward_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`);
    for (const template of templates) {
      if (rows.has(template.id) || (template.schedule_type === 'weekly_times' && !template.allow_extra && this.weeklyCount(childId, template.id, date) >= template.weekly_target_times)) continue;
      rows.set(template.id, insert.get(generateId(), childId, template.id, template.title, template.subject, template.points,
        date, template.schedule_type, template.weekly_target_times, template.id, template.created_at,
        template.track_time ? 1 : 0, template.expected_minutes, template.carry_over ? 1 : 0,
        template.allow_extra ? 1 : 0, template.extra_points, template.extra_reward_limit));
    }
    return rows;
  }

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
    this.wordStudyService?.ensureScheduled(childId);
    const schedule = this.scheduleFor(childId);
    const matching = schedule.assigned.filter(t => schedule.allowedOn(t.id, date));
    const classLessons = this.classTasksOn(childId)(date);
    this.db.transaction(() => {
      if (date === getTodayDate()) {
        this.removeUnassignedTodayTasks();
        this.reconcileCalendarDay(childId, date, schedule);
      }
      this.generateTemplateTasks(childId, date, matching);
      const goalRow = this.db.prepare('SELECT id FROM daily_tasks WHERE goal_id = ? AND date = ?');
      const loggedOn = this.db.prepare('SELECT 1 FROM period_task_logs WHERE period_task_id = ? AND date = ?');
      for (const goal of this.dailyGoalsOn(childId, date)) {
        if (!goalRow.get(goal.id, date)) insertGoalDailyRow(this.db, goal, date, Boolean(loggedOn.get(goal.id, date)));
      }
      // An outside class that makes check-ins is a task on each day its lesson takes place.
      const classRow = this.db.prepare('SELECT id FROM daily_tasks WHERE child_id = ? AND class_id = ? AND date = ? AND COALESCE(class_lesson_date, date) = ?');
      const insertClass = this.db.prepare(`INSERT INTO daily_tasks
        (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times, origin, class_id, class_lesson_date)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 0, NULL, 'fixed_days', NULL, 'class', ?, ?)`);
      for (const lesson of classLessons) {
        if (!classRow.get(childId, lesson.class_id, date, lesson.class_lesson_date)) {
          insertClass.run(generateId(), childId, lesson.title, lesson.subject, lesson.points, date, lesson.class_id, lesson.class_lesson_date);
        }
      }
    })();
    // The latest skip request tells the child whether one is waiting or was turned down.
    const latestSkip = this.db.prepare('SELECT id, status, reason FROM task_skip_requests WHERE daily_task_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1');
    // A class check-in carries its lesson's time and place for the card.
    const lessonOf = new Map(this.scheduleService ? this.scheduleService.outsideLessons(childId)(date)
      .filter(l => ['scheduled', 'moved_in'].includes(l.status)).map(l => [classLessonKey(l), l]) : []);
    // Tasks of earlier days whose deadline has not passed come along, as do ones done (or skipped)
    // on this day, so the child sees what is done; they stay optional until their last day.
    const doneOn = iso => iso && formatDate(new Date(iso)) === date;
    const carriedRows = this.carriedBetween(childId, date, date, schedule);
    // Summaries project unopened tasks without writing history. A board needs persisted ids so
    // the child can time, complete or request to skip those same tasks.
    if (carriedRows.some(({ row }) => row.projected)) {
      this.db.transaction(() => {
        const byDate = new Map();
        for (const carried of carriedRows) {
          const row = carried.row;
          if (!row.projected) continue;
          if (!byDate.has(row.date)) {
            // A generated date is a snapshot for weekly completion. Include its other templates
            // too, so materializing a carry cannot hide that day's ordinary unfinished tasks.
            byDate.set(row.date, this.generateTemplateTasks(childId, row.date,
              schedule.assigned.filter(t => t.since <= row.date && schedule.allowedOn(t.id, row.date))));
          }
          carried.row = byDate.get(row.date).get(row.template_id);
        }
      })();
    }
    const carried = carriedRows
      .filter(({ row }) => row.is_completed ? row.completion_source !== 'parent_backfill' && doneOn(row.completed_at) : !row.skipped_at || doneOn(row.skipped_at))
      .map(({ row, due }) => ({ ...describeRow(row), carried_from: row.date, due_date: due, is_optional: due > date }));
    return [...this.describeTasksBetween(childId, date, date).filter(isActiveTask), ...carried]
      .map(task => {
        const lesson = task.class_id && lessonOf.get(classLessonKey(task));
        return { ...task, skip_request: latestSkip.get(task.id) || null,
          class_lesson: lesson ? { start_time: lesson.start_time, end_time: lesson.end_time, location: lesson.location, institution: lesson.institution } : null };
      });
  }

  calendarFor(childId) {
    return schoolCalendar(this.db, childId);
  }

  // Tasks of earlier days that may still be done on some day between two dates (their deadline is
  // on or after `from`): carried over a break, or one-off tasks with a later due date.
  carriedBetween(childId, from, to, schedule = this.scheduleFor(childId)) {
    const { calendar } = schedule;
    const first = shiftDate(from, -MAX_CARRY_DAYS);
    // Include non-carrying snapshots too: a template edit must not project a second task over one.
    const rows = this.db.prepare(`SELECT * FROM daily_tasks WHERE child_id = ? AND date < ? AND date >= ? ORDER BY date, rowid`)
      .all(childId, to, first);
    const existing = new Set(rows.map(row => `${row.source_template_id ?? row.template_id}|${row.date}`));
    const templates = schedule.assigned.filter(t => t.carry_over && t.schedule_type !== 'weekly_times');
    const start = [first, schedule.childSince].filter(Boolean).sort().at(-1);
    if (templates.length && schedule.childSince) {
      for (let date = start; date < to; date = shiftDate(date, 1)) {
        const due = calendar.carryUntil(date);
        if (due < from || due <= date) continue;
        for (const template of templates) {
          if (template.since > date || !schedule.allowedOn(template.id, date) || existing.has(`${template.id}|${date}`)) continue;
          rows.push({ id: `unopened:${template.id}:${date}`, child_id: childId, template_id: template.id,
            source_template_id: template.id, template_created_at: template.created_at, origin: 'template',
            title: template.title, subject: template.subject, points: template.points, date,
            schedule_type: 'fixed_days', weekly_target_times: null, is_completed: 0, completed_at: null,
            track_time: template.track_time ? 1 : 0, expected_minutes: template.expected_minutes,
            duration_seconds: null, carry_over: 1, due_date: null, projected: true });
        }
      }
    }
    return rows.filter(row => row.carry_over || row.due_date)
      .map(row => ({ row, due: dueDateOf(row, calendar) }))
      .filter(({ row, due }) => due >= from && due > row.date);
  }

  // Each day's tasks for summaries (history, all-done, rest days): its own tasks, plus tasks of
  // earlier days left undone by their deadline that day, which count as missed there. A carried
  // task done in time counts on its own day only.
  summaryTasksBetween(childId, fromDate, toDate, { schedule = this.scheduleFor(childId), ...options } = {}) {
    const missed = this.carriedBetween(childId, fromDate, toDate, schedule)
      .filter(({ row, due }) => due <= toDate && !row.is_completed && !row.skipped_at)
      .map(({ row, due }) => ({ ...describeRow(row), date: due, carried_from: row.date, due_date: due, is_optional: false }));
    return [...this.describeTasksBetween(childId, fromDate, toDate, { ...options, schedule }), ...missed];
  }

  // Children may act on a task from its own day until its deadline.
  childMayActOn(row) {
    const today = getTodayDate();
    return row.date <= today && today <= dueDateOf(row, this.calendarFor(row.child_id));
  }

  // Outside-class lessons that are check-in tasks, per date (none without the schedule service).
  classTasksOn(childId) {
    return this.scheduleService ? this.scheduleService.classTaskSchedule(childId) : () => [];
  }

  // Times a weekly task was done or skipped this week: both use up its weekly target.
  weeklyCount(childId, templateId, date) {
    const { startDate, endDate } = getWeekRange(date);
    return this.db.prepare("SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ? AND COALESCE(source_template_id, template_id) = ? AND schedule_type = 'weekly_times' AND date BETWEEN ? AND ? AND is_extra_completion = 0 AND (is_completed = 1 OR skipped_at IS NOT NULL)")
      .get(childId, templateId, startDate, endDate).n;
  }

  weeklyExtraRewardCount(task) {
    const { startDate, endDate } = getWeekRange(task.date);
    return this.db.prepare(`SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ?
      AND COALESCE(source_template_id, template_id) = ? AND schedule_type = 'weekly_times'
      AND date BETWEEN ? AND ? AND is_completed = 1 AND is_extra_completion = 1 AND earned_points > 0`)
      .get(task.child_id, task.source_template_id ?? task.template_id, startDate, endDate).n;
  }

  describeTask(t) {
    return this.describeTasksBetween(t.child_id, t.date, t.date, { includePaused: true }).find(task => task.id === t.id);
  }

  // Describes a child's tasks between two dates with weekly progress, using one query over
  // the surrounding weeks. A weekly task is optional on a day while the times still needed
  // (counting only earlier days, so past days never change) are fewer than the days left
  // in the week including that day; once there is no slack it is required that day. A skipped
  // time takes one off the target, so skipping on a day without slack still keeps the week whole.
  describeTasksBetween(childId, fromDate, toDate, { includePaused = false, schedule = this.scheduleFor(childId) } = {}) {
    const weekStarts = new Map();
    const weekOf = date => {
      if (!weekStarts.has(date)) weekStarts.set(date, getWeekRange(date).startDate);
      return weekStarts.get(date);
    };
    // Filter obsolete pending goal rows in this query, keeping history reads at a constant cost.
    const rows = this.db.prepare(`SELECT d.*, (SELECT required FROM word_study_days WHERE id = d.study_day_id) AS study_required FROM daily_tasks d WHERE d.child_id = ? AND d.date BETWEEN ? AND ?
      AND (d.is_completed = 1 OR d.goal_id IS NULL OR EXISTS (
        SELECT 1 FROM period_tasks g WHERE g.id = d.goal_id AND g.daily_required = 1
        AND g.start_date <= d.date AND (g.end_date IS NULL OR g.end_date >= d.date)
        AND (g.completed_at IS NULL OR d.date <= (SELECT MAX(date) FROM period_task_logs WHERE period_task_id = g.id))
      )) ORDER BY d.date, d.rowid`)
      .all(childId, weekOf(fromDate), getWeekRange(toDate).endDate);
    const sourceOf = row => row.source_template_id ?? row.template_id;
    const keyOf = row => `${weekOf(row.date)}|${sourceOf(row) ?? row.id}`;
    const completions = new Map();
    const skips = new Map();
    const extras = new Map();
    const paidExtras = new Map();
    for (const row of rows) {
      if (row.schedule_type !== 'weekly_times') continue;
      if (row.is_completed && row.is_extra_completion && row.earned_points > 0) paidExtras.set(keyOf(row), (paidExtras.get(keyOf(row)) || 0) + 1);
      const dates = row.is_completed ? (row.is_extra_completion ? extras : completions) : isSkippedRow(row) ? skips : null;
      if (!dates) continue;
      if (!dates.has(keyOf(row))) dates.set(keyOf(row), []);
      dates.get(keyOf(row)).push(row.date);
    }

    return rows.filter(row => row.date >= fromDate && row.date <= toDate &&
      (includePaused || row.is_completed || !schedule.isPaused(sourceOf(row), row.date))).map(row => {
      const task = describeRow(row);
      // A task that may wait out a break (or a one-off task due later) is optional until its deadline.
      if (row.schedule_type !== 'weekly_times') {
        if (row.origin === 'study') return { ...task, is_optional: !row.study_required };
        const due = dueDateOf(row, schedule.calendar);
        return { ...task, due_date: due > row.date ? due : null, is_optional: due > row.date };
      }
      const done = completions.get(keyOf(row)) || [];
      const skipped = skips.get(keyOf(row)) || [];
      const extraDone = extras.get(keyOf(row)) || [];
      const rewardedExtras = paidExtras.get(keyOf(row)) || 0;
      const target = row.weekly_target_times || 1;
      const isExtra = row.is_completed ? Boolean(row.is_extra_completion) : !row.skipped_at && done.length + skipped.length >= target;
      const award = isExtra ? (rewardedExtras < row.extra_reward_limit ? row.extra_points : 0) : row.points;
      const usedBefore = [...done, ...skipped].filter(date => date < row.date).length;
      // The task's own day plus the remaining days this week it may still be done.
      const daysLeft = 1 + schedule.availableDays(sourceOf(row), shiftDate(row.date, 1), getWeekRange(row.date).endDate);
      return {
        ...task,
        is_extra: isExtra,
        award_points: row.is_completed ? row.earned_points : award,
        weekly_completed_times: done.length + extraDone.length,
        weekly_target_completed_times: done.length,
        weekly_extra_completed_times: extraDone.length,
        weekly_extra_rewarded_times: rewardedExtras,
        weekly_skipped_times: skipped.length,
        weekly_remaining_times: Math.max(0, target - done.length - skipped.length),
        week_days_left: daysLeft,
        is_optional: isExtra || target - usedBefore < daysLeft
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
    const calendar = this.calendarFor(childId);
    // A make-up school day inside a holiday is a school day: nothing is paused on it.
    const isPaused = (templateId, date) => !calendar.makeupOn(date) && pausedRanges.some(range =>
      range.template_id === templateId && range.start_date <= date && range.end_date >= date);
    // Deleted templates are unknown and treated as available every day. A make-up day follows the
    // weekday it stands in for.
    const allowedOn = (templateId, date) => {
      const template = byId.get(templateId);
      return !isPaused(templateId, date) && (!template || template.days_of_week.includes(calendar.weekdayOf(date)));
    };
    return {
      calendar,
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
    for (const task of this.summaryTasksBetween(childId, getWeekRange(fromDate).startDate, toDate, { schedule }).filter(isActiveTask)) {
      if (task.is_extra) continue;
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
        // A task that may wait out the break that follows was optional that day.
        if (t.schedule_type !== 'weekly_times') return !(t.carry_over && schedule.calendar.carryUntil(date) > date);
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
  createAdhocTask(childId, { title, subject, points = 10, date, due_date = null, track_time, expected_minutes }) {
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
    // A due date lets the task be done until then (e.g. a poster due on Friday); it may not be
    // earlier than the task's day, and the same day means no extra time.
    if (due_date !== null) {
      try {
        parseDate(due_date);
      } catch {
        throw { status: 400, message: '截止日期必须为 YYYY-MM-DD' };
      }
      if (due_date < taskDate) throw { status: 400, message: '截止日期不能早于布置的日期' };
      if (due_date > shiftDate(taskDate, MAX_CARRY_DAYS)) throw { status: 400, message: `截止日期最多在 ${MAX_CARRY_DAYS} 天后` };
    }
    const id = generateId();
    this.db.prepare(`INSERT INTO daily_tasks
      (id, child_id, template_id, title, subject, points, date, is_completed, completed_at, schedule_type, weekly_target_times, origin, track_time, expected_minutes, due_date)
      VALUES (?, ?, NULL, ?, ?, ?, ?, 0, NULL, 'fixed_days', NULL, 'adhoc', ?, ?, ?)`)
      .run(id, childId, title.trim(), subject.trim(), points, taskDate, timing.track_time ? 1 : 0, timing.expected_minutes,
        due_date && due_date > taskDate ? due_date : null);
    return this.describeTask(this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id));
  }

  // One-off tasks from a date on, including earlier ones whose due date has not passed.
  listAdhocTasks(childId, fromDate = getTodayDate()) {
    return this.db.prepare("SELECT * FROM daily_tasks WHERE child_id = ? AND origin = 'adhoc' AND (date >= ? OR due_date >= ?) ORDER BY date, rowid")
      .all(childId, fromDate, fromDate).map(row => ({ ...row, is_completed: Boolean(row.is_completed) }));
  }

  // Removing a one-off task also removes the points it earned (its point log goes with it).
  deleteAdhocTask(id) {
    const task = this.db.prepare('SELECT origin FROM daily_tasks WHERE id = ?').get(id);
    if (!task || task.origin !== 'adhoc') throw { status: 404, message: '临时任务不存在' };
    this.db.prepare('DELETE FROM daily_tasks WHERE id = ?').run(id);
    return { success: true, id };
  }

  // Reading this list must never generate or reconcile historical rows.
  getBackfillTasks(childId, date) {
    if (typeof childId !== 'string' || !childId) throw { status: 400, message: '请选择孩子' };
    parseDate(date);
    if (date >= getTodayDate()) throw { status: 400, message: '补卡日期必须早于今天' };
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) {
      throw { status: 404, message: '孩子不存在' };
    }
    return {
      tasks: this.describeTasksBetween(childId, date, date, { includePaused: true }).filter(task => !['goal', 'study'].includes(task.origin)),
      events: this.db.prepare('SELECT * FROM task_backfill_events WHERE child_id = ? AND task_date = ? ORDER BY created_at DESC, rowid DESC')
        .all(childId, date)
    };
  }

  backfillDailyTask(taskId, { duration_seconds = null } = {}) {
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (!task) throw { status: 404, message: '任务不存在' };
    if (task.date >= getTodayDate()) throw { status: 400, message: '只能补记过去日期的任务' };
    return this.completeDailyTask(taskId, { duration_seconds, completionSource: 'parent_backfill' });
  }

  undoBackfillDailyTask(taskId) {
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (!task) throw { status: 404, message: '任务不存在' };
    if (!task.is_completed) return { success: true, task: this.describeTask(task) };
    if (task.completion_source !== 'parent_backfill') throw { status: 409, message: '只能撤销家长补卡记录' };
    return this.uncompleteDailyTask(taskId, { allowNegativeBalance: true });
  }

  recordBackfillEvent(task, action, duration, now) {
    this.db.prepare(`INSERT INTO task_backfill_events
      (id, child_id, daily_task_id, task_title, task_date, action, points, duration_seconds, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(generateId(), task.child_id, task.id, task.title, task.date, action,
        action === 'complete' ? task.earned_points : -(task.earned_points ?? task.points), duration, now);
  }

  // A timed task records its duration: the one given (null for none), else what its timer counted.
  completeDailyTask(taskId, { duration_seconds, completionSource = null } = {}) {
    const task = this.db.prepare(`
      SELECT *
      FROM daily_tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      throw { status: 404, message: 'Daily task not found' };
    }

    // A long-term task's daily row is completed by logging progress, never directly.
    if (task.origin === 'study') throw { status: 409, message: '请在字词学习中逐项练习，不能直接打卡或撤销' };
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
    let isExtra = false;
    if (task.schedule_type === 'weekly_times') {
      const source = task.source_template_id ?? task.template_id;
      const another = this.db.prepare(`SELECT id FROM daily_tasks WHERE child_id = ? AND COALESCE(source_template_id, template_id) = ?
        AND date = ? AND id != ? AND (is_completed = 1 OR skipped_at IS NOT NULL)`).get(task.child_id, source, task.date, task.id);
      if (another) throw { status: 409, message: '同一任务每天最多完成一次' };
      isExtra = this.weeklyCount(task.child_id, source, task.date) >= task.weekly_target_times;
      if (isExtra && !task.allow_extra) throw { status: 409, message: '本周目标已完成' };
    }
    const earned = isExtra ? (this.weeklyExtraRewardCount(task) < task.extra_reward_limit ? task.extra_points : 0) : task.points;
    const duration = task.track_time ? resolveDuration(task, duration_seconds) : { seconds: null, source: null };
    const now = new Date().toISOString();
    let newBadges = [];

    const tx = this.db.transaction(() => {
      // 1. Update task to completed; doing it withdraws a skip request still waiting for a parent
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 1, completed_at = ?, duration_seconds = ?, duration_source = ?,
          timer_elapsed_seconds = ?, timer_started_at = NULL, completion_source = ?, is_extra_completion = ?, earned_points = ?
        WHERE id = ?
      `).run(now, duration.seconds, duration.source, timerSeconds(task), completionSource, isExtra ? 1 : 0, earned, taskId);
      if (completionSource === 'parent_backfill') this.recordBackfillEvent({ ...task, earned_points: earned }, 'complete', duration.seconds, now);
      cancelPendingSkips(this.db, taskId, now);

      // 2. Insert point log
      this.db.prepare(`
        INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at, activity_date, activity_title)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), task.child_id, task.id, earned, now, task.date, task.title);

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
      points_earned: earned,
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
    if (task.origin === 'study') throw { status: 409, message: '请在字词学习中逐项练习，不能直接打卡或撤销' };
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
      if (earned > 0 && this.rewardsService.getAvailablePoints(task.child_id) < earned) {
        throw { status: 409, message: '这项任务的积分已用于兑换奖励，不能取消打卡' };
      }
    }

    const tx = this.db.transaction(() => {
      // 1. Revert task
      // The timer keeps its time for when the task is done again; the recorded duration goes.
      this.db.prepare(`
        UPDATE daily_tasks
        SET is_completed = 0, completed_at = NULL, duration_seconds = NULL, duration_source = NULL, completion_source = NULL, is_extra_completion = 0, earned_points = NULL
        WHERE id = ?
      `).run(taskId);

      if (task.completion_source === 'parent_backfill') this.recordBackfillEvent(task, 'undo', task.duration_seconds, new Date().toISOString());

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
