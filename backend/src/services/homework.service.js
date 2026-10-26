const { validatePriority } = require('../utils/priority');
const { generateId } = require('../utils/crypto');
const { getTodayDate, parseDate, shiftDate } = require('../utils/date');
const { validateTiming } = require('../utils/timer');
const { schoolCalendar, MAX_CARRY_DAYS } = require('./calendar');
const { CLASS_TASK_SUBJECT, weekLabel } = require('./schedule.service');

const fail = (status, message) => ({ status, message });

const DEFAULT_POINTS = 10;
const MAX_CONTENT = 500;
const MAX_TASK_TITLE = 50;
// How far back the default assigned date looks for the course's latest lesson.
const LAST_LESSON_LOOKBACK = 30;
// Board subjects; other school subjects are filed under 其他.
const TASK_SUBJECTS = ['语文', '数学', '英语'];

function validateDate(value, label) {
  try {
    parseDate(value);
  } catch {
    throw fail(400, `${label}必须为 YYYY-MM-DD`);
  }
  return value;
}

function validatePoints(points) {
  if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw fail(400, '积分必须为 0 至 10000 的整数');
  return points;
}

const courseKey = course => course.kind === 'class' ? `class:${course.class_id}` : `school:${course.subject}`;
const later = (a, b) => (a > b ? a : b);

// The task a record puts on the board: "语文：抄写第5课生字", cut to the board's title limit.
function taskTitle(record) {
  const firstLine = record.content.split('\n').map(line => line.trim()).find(Boolean) || '';
  const title = `${record.subject}：${firstLine}`;
  return title.length > MAX_TASK_TITLE ? `${title.slice(0, MAX_TASK_TITLE - 1)}…` : title;
}

function taskSubject(record) {
  if (record.course_kind === 'class') return CLASS_TASK_SUBJECT;
  return TASK_SUBJECTS.includes(record.subject) ? record.subject : '其他';
}

// Homework records (作业记录): what a teacher set in a lesson, kept to look up later. By default it is
// due the day before the course's next lesson; while that day has not passed, the record may own a
// one-off task on the board. A child may record homework too, but its task waits for a parent.
class HomeworkService {
  constructor(db, tasksService, scheduleService) {
    this.db = db;
    this.tasksService = tasksService;
    this.scheduleService = scheduleService;
  }

  requireChild(childId) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw fail(404, '孩子不存在');
  }

  // --- Courses and their lessons ---

  classesOf(childId) {
    // The final lesson may be moved beyond the nominal end of a counted course. Keep it
    // selectable for homework through that moved lesson, using only still-valid source dates.
    return this.db.prepare(`SELECT id, title, start_date,
      CASE WHEN end_date IS NULL THEN NULL ELSE MAX(end_date, COALESCE((
        SELECT MAX(e.new_date) FROM outside_class_exceptions e
        WHERE e.class_id = c.id AND e.child_id = ? AND e.kind = 'moved'
          AND e.date >= c.start_date AND e.date <= c.end_date
          AND CAST(strftime('%w', e.date) AS INTEGER) IN (SELECT value FROM json_each(c.days_of_week))
      ), end_date)) END AS end_date FROM outside_classes c
      WHERE c.assign_all = 1 OR EXISTS (SELECT 1 FROM outside_class_children WHERE class_id = c.id AND child_id = ?)
      ORDER BY c.start_time, c.title`).all(childId, childId);
  }

  // Tells whether a course has a lesson on a date: school lessons follow the timetable of the date
  // (A/B weeks, make-up days, none on holidays); outside classes follow their leave and moves.
  lessonChecker(childId) {
    const calendar = schoolCalendar(this.db, childId);
    const timetables = this.db.prepare('SELECT * FROM timetables WHERE child_id = ?').all(childId).map(row => ({
      ...row,
      lessons: this.db.prepare('SELECT weekday, week, subject FROM timetable_lessons WHERE timetable_id = ?').all(row.id)
    }));
    const outsideOn = this.scheduleService.outsideLessons(childId);
    return (course, date) => {
      if (course.kind === 'class') {
        return outsideOn(date).some(lesson => lesson.class_id === course.class_id && ['scheduled', 'moved_in'].includes(lesson.status));
      }
      if (calendar.holidayOn(date)) return false;
      const timetable = timetables.find(t => t.start_date <= date && t.end_date >= date);
      if (!timetable) return false;
      const weekday = calendar.weekdayOf(date);
      const week = weekLabel(timetable, date);
      return timetable.lessons.some(l => l.subject === course.subject && l.weekday === weekday && (l.week === 'all' || l.week === week));
    };
  }

  // The course's first lesson after a date, and the default due date: the day before it, since
  // homework is done at home. No lesson within the carry limit (no timetable, end of term): none.
  dueFor(course, assignedDate, hasLesson) {
    for (let i = 1; i <= MAX_CARRY_DAYS; i++) {
      const date = shiftDate(assignedDate, i);
      if (hasLesson(course, date)) return { next_lesson_date: date, due_date: shiftDate(date, -1) };
    }
    return { next_lesson_date: null, due_date: null };
  }

  lastLessonOnOrBefore(course, date, hasLesson) {
    for (let i = 0; i <= LAST_LESSON_LOOKBACK; i++) {
      const day = shiftDate(date, -i);
      if (hasLesson(course, day)) return day;
    }
    return null;
  }

  coursePoints(key) {
    return this.db.prepare('SELECT points FROM homework_course_points WHERE course_key = ?').get(key)?.points ?? DEFAULT_POINTS;
  }

  // The courses a child may record homework for: subjects of the current timetable (of any
  // timetable when none covers today), most frequent first, and the child's running classes. Each
  // comes with its default points and, for homework set in its latest lesson, the default dates.
  listCourses(childId) {
    this.requireChild(childId);
    const today = getTodayDate();
    const subjects = this.db.prepare(`SELECT l.subject, COUNT(*) AS lessons, MAX(t.start_date <= ? AND t.end_date >= ?) AS current
      FROM timetable_lessons l JOIN timetables t ON t.id = l.timetable_id WHERE t.child_id = ? GROUP BY l.subject`).all(today, today, childId);
    const current = subjects.filter(row => row.current);
    const courses = [
      ...(current.length ? current : subjects).sort((a, b) => b.lessons - a.lessons || a.subject.localeCompare(b.subject, 'zh-Hans-CN'))
        .map(row => ({ kind: 'school', subject: row.subject, class_id: null })),
      ...this.classesOf(childId).filter(row => !row.end_date || row.end_date >= today)
        .map(row => ({ kind: 'class', subject: row.title, class_id: row.id }))
    ];
    const hasLesson = this.lessonChecker(childId);
    return courses.map(course => {
      const last = this.lastLessonOnOrBefore(course, today, hasLesson);
      const assigned = last ?? today;
      return { ...course, course_key: courseKey(course), points: this.coursePoints(courseKey(course)),
        last_lesson_date: last, assigned_date: assigned, ...this.dueFor(course, assigned, hasLesson) };
    });
  }

  // A school subject (from the timetable or typed in) or one of the child's outside classes.
  resolveCourse(childId, { course_kind = 'school', subject, class_id }) {
    if (course_kind === 'class') {
      const row = this.classesOf(childId).find(c => c.id === class_id);
      if (!row) throw fail(400, '请选择这个孩子的课外班');
      return { kind: 'class', subject: row.title, class_id: row.id };
    }
    if (course_kind !== 'school') throw fail(400, '课程类型无效');
    if (typeof subject !== 'string' || !subject.trim()) throw fail(400, '请选择科目');
    if (subject.trim().length > 10) throw fail(400, '科目不超过 10 个字');
    return { kind: 'school', subject: subject.trim(), class_id: null };
  }

  // Default dates for homework set on a date, and the same-subject daily tasks of the day its task
  // would start, which may already cover it (e.g. 数学练习册).
  suggest(childId, query) {
    this.requireChild(childId);
    const course = this.resolveCourse(childId, query);
    const today = getTodayDate();
    const assigned = query.assigned_date === undefined ? today : validateDate(query.assigned_date, '布置日期');
    const dates = this.dueFor(course, assigned, this.lessonChecker(childId));
    return { course_key: courseKey(course), points: this.coursePoints(courseKey(course)), assigned_date: assigned, ...dates,
      same_subject_tasks: this.sameSubjectTasks(childId, course, later(assigned, today)) };
  }

  sameSubjectTasks(childId, course, date) {
    const subject = taskSubject({ course_kind: course.kind, subject: course.subject });
    if (!TASK_SUBJECTS.includes(subject)) return [];
    const schedule = this.tasksService.scheduleFor(childId);
    return schedule.assigned.filter(t => t.subject === subject && t.since <= date && schedule.allowedOn(t.id, date)).map(t => t.title);
  }

  // --- Records ---

  describe(row) {
    const { task_id, task_date, task_completed, task_skipped_at, task_points, task_due_date, task_priority, task_default_priority, task_priority_override, ...record } = row;
    const today = getTodayDate();
    const task = task_id ? {
      priority: task_priority, default_priority: task_default_priority, priority_override: task_priority_override, id: task_id, date: task_date, points: task_points, due_date: task_due_date ?? task_date,
      is_completed: Boolean(task_completed), is_skipped: Boolean(task_skipped_at) && !task_completed
    } : null;
    // pending: a child asked for a task; open, done, skipped or missed: the task's state; none: record only.
    const taskState = task ? (task.is_completed ? 'done' : task.is_skipped ? 'skipped' : task.due_date < today ? 'missed' : 'open')
      : record.task_requested ? 'pending' : 'none';
    return { ...record, task_requested: Boolean(record.task_requested),
      task, task_state: taskState, can_create_task: !task && Boolean(record.due_date) && record.due_date >= today };
  }

  query(where, params) {
    return this.db.prepare(`SELECT r.*, d.id AS task_id, d.date AS task_date, d.is_completed AS task_completed, d.skipped_at AS task_skipped_at,
      d.points AS task_points, d.due_date AS task_due_date,
      COALESCE(d.priority_override, d.priority) AS task_priority, d.priority AS task_default_priority, d.priority_override AS task_priority_override,
      COALESCE(d.homework_legacy_seconds, 0) + COALESCE((SELECT SUM(duration_seconds) FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NOT NULL), 0) AS study_seconds,
      (SELECT COUNT(*) FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NOT NULL) AS study_count,
      EXISTS(SELECT 1 FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NULL AND s.timer_started_at IS NOT NULL) AS study_running, c.name AS child_name, c.avatar_emoji AS child_avatar_emoji
      FROM homework_records r JOIN children c ON c.id = r.child_id LEFT JOIN daily_tasks d ON d.id = r.daily_task_id
      WHERE ${where} ORDER BY r.assigned_date DESC, r.created_at DESC`).all(...params).map(row => this.describe(row));
  }

  get(id) {
    const [record] = this.query('r.id = ?', [id]);
    if (!record) throw fail(404, '作业记录不存在');
    return record;
  }

  // A child's records, newest first: by course, by assigned dates, or by words in the content.
  list(childId, { subject, class_id, from, to, q } = {}) {
    this.requireChild(childId);
    const where = ['r.child_id = ?'];
    const params = [childId];
    if (class_id) { where.push('r.course_key = ?'); params.push(`class:${class_id}`); }
    else if (subject) { where.push("r.subject = ? AND r.course_kind = 'school'"); params.push(subject); }
    if (from) { where.push('r.assigned_date >= ?'); params.push(validateDate(from, '开始日期')); }
    if (to) { where.push('r.assigned_date <= ?'); params.push(validateDate(to, '结束日期')); }
    if (typeof q === 'string' && q.trim()) {
      where.push("r.content LIKE ? ESCAPE '\\'");
      params.push(`%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`);
    }
    return this.query(where.join(' AND '), params);
  }

  // Per course, how the homework set between two dates (by assigned date) went: how many records,
  // and their tasks done, missed, skipped, still open or waiting for a parent, or none at all. The
  // completion rate counts settled tasks only (done or missed). Also the term timetable of today,
  // so the page can offer it as a range.
  summary(childId, { from, to } = {}) {
    const records = this.list(childId, { from, to });
    const courses = new Map();
    for (const record of records) {
      if (!courses.has(record.course_key)) {
        courses.set(record.course_key, { course_key: record.course_key, kind: record.course_kind, subject: record.subject, class_id: record.class_id,
          total: 0, done: 0, missed: 0, skipped: 0, open: 0, pending: 0, none: 0, latest_assigned_date: record.assigned_date });
      }
      const course = courses.get(record.course_key);
      course.total += 1;
      course[record.task_state] += 1;
    }
    const rate = row => (row.done + row.missed ? row.done / (row.done + row.missed) : null);
    const rows = [...courses.values()].sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject, 'zh-Hans-CN'))
      .map(row => ({ ...row, completion_rate: rate(row) }));
    const totals = { total: 0, done: 0, missed: 0, skipped: 0, open: 0, pending: 0, none: 0 };
    for (const row of rows) for (const key of Object.keys(totals)) totals[key] += row[key];
    const today = getTodayDate();
    const term = this.db.prepare('SELECT name, start_date, end_date FROM timetables WHERE child_id = ? AND start_date <= ? AND end_date >= ?').get(childId, today, today) ?? null;
    return { from: from ?? null, to: to ?? null, term, courses: rows, totals: { ...totals, completion_rate: rate(totals) } };
  }

  // Children's records waiting for a parent to create their tasks, across children.
  listTaskRequests() {
    return this.query('r.task_requested = 1 AND r.daily_task_id IS NULL', []);
  }

  validateDates(assigned, due, today) {
    validateDate(assigned, '布置日期');
    if (assigned > today) throw fail(400, '布置日期不能晚于今天');
    if (due === null) return;
    validateDate(due, '截止日期');
    if (due < assigned) throw fail(400, '截止日期不能早于布置日期');
    if (due > shiftDate(assigned, MAX_CARRY_DAYS)) throw fail(400, `截止日期最多在布置后 ${MAX_CARRY_DAYS} 天`);
  }

  // Left out, the due date is the day before the course's next lesson. With create_task, a task is
  // created at once for a parent, or requested for a child; past-due homework is only recorded.
  create(childId, body, actor) {
    this.requireChild(childId);
    if (actor !== 'parent' && Object.hasOwn(body, 'priority')) throw fail(403, '只有家长可以设置优先级');
    const priority = validatePriority(body.priority);
    const course = this.resolveCourse(childId, body);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) throw fail(400, '请填写作业内容');
    if (content.length > MAX_CONTENT) throw fail(400, `作业内容不超过 ${MAX_CONTENT} 个字`);
    const today = getTodayDate();
    const assigned = body.assigned_date ?? today;
    validateDate(assigned, '布置日期');
    const due = body.due_date === undefined ? this.dueFor(course, assigned, this.lessonChecker(childId)).due_date : body.due_date;
    this.validateDates(assigned, due, today);
    // A child's record takes the course's points; the parent sets them when creating its task.
    const points = actor === 'parent' && body.points !== undefined && body.points !== null ? validatePoints(body.points) : this.coursePoints(courseKey(course));
    if (body.create_task !== undefined && typeof body.create_task !== 'boolean') throw fail(400, '是否生成任务的设置无效');
    if (body.create_task && (!due || due < today)) throw fail(400, due ? '截止日期已过，只能保存作业记录，不能生成任务' : '没有截止日期，不能生成任务');
    const timing = actor === 'parent' && body.create_task ? validateTiming(body) : null;
    const id = generateId();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO homework_records (id, child_id, course_kind, course_key, subject, class_id, assigned_date, due_date, content, points,
        created_by, task_requested, daily_task_id, created_at, updated_at, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
        .run(id, childId, course.kind, courseKey(course), course.subject, course.class_id, assigned, due, content, points, actor,
          body.create_task && actor !== 'parent' ? 1 : 0, now, now, priority);
      if (timing) this.attachTask(id, timing);
    })();
    return this.get(id);
  }

  // The record's one-off task: from the assigned day (today at the earliest, so past days keep their
  // history) until the due date, worth the record's points.
  attachTask(id, timing) {
    const record = this.db.prepare('SELECT * FROM homework_records WHERE id = ?').get(id);
    const today = getTodayDate();
    if (record.daily_task_id) throw fail(409, '这条作业已经生成了任务');
    if (!record.due_date || record.due_date < today) throw fail(409, record.due_date ? '截止日期已过，不能生成任务' : '没有截止日期，不能生成任务');
    const task = this.tasksService.createAdhocTask(record.child_id, { title: taskTitle(record), subject: taskSubject(record), points: record.points,
      date: later(record.assigned_date, today), due_date: record.due_date, priority: record.priority, ...timing });
    this.db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = 0, is_course_homework = 1 WHERE id = ?').run(task.id);
    this.db.prepare('UPDATE homework_records SET daily_task_id = ?, task_requested = 0, updated_at = ? WHERE id = ?').run(task.id, new Date().toISOString(), id);
  }

  // A parent creates a record's task, settling a child's request; points and due date may change first.
  createTask(id, body = {}) {
    const record = this.get(id);
    const timing = validateTiming(body);
    this.db.transaction(() => {
      if (body.points !== undefined || body.due_date !== undefined || body.priority !== undefined) {
        const points = body.points === undefined ? record.points : validatePoints(body.points);
        const due = body.due_date === undefined ? record.due_date : body.due_date;
        this.validateDates(record.assigned_date, due, getTodayDate());
        this.db.prepare('UPDATE homework_records SET points = ?, due_date = ?, priority = ? WHERE id = ?').run(points, due, validatePriority(body.priority === undefined ? record.priority : body.priority), id);
      }
      this.attachTask(id, timing);
    })();
    return this.get(id);
  }

  rejectTask(id) {
    const record = this.get(id);
    if (!record.task_requested) throw fail(409, '这条作业没有待确认的任务申请');
    this.db.prepare('UPDATE homework_records SET task_requested = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.get(id);
  }

  // A child may change or delete only records they made that have no task; a parent any record.
  requireEditable(record, actor) {
    if (actor === 'parent') return;
    if (record.created_by !== 'child' || record.task) throw fail(403, '这条作业记录只能由家长修改');
  }

  // Content, dates and points. An open task follows: its title, points and due date; a task done,
  // skipped or past its due date keeps its history.
  update(id, body, actor) {
    const record = this.get(id);
    this.requireEditable(record, actor);
    if (actor !== 'parent' && Object.hasOwn(body, 'priority')) throw fail(403, '只有家长可以设置优先级');
    const priority = validatePriority(body.priority === undefined ? record.priority : body.priority);
    const today = getTodayDate();
    let content = record.content;
    if (body.content !== undefined) {
      content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) throw fail(400, '请填写作业内容');
      if (content.length > MAX_CONTENT) throw fail(400, `作业内容不超过 ${MAX_CONTENT} 个字`);
    }
    const assigned = body.assigned_date ?? record.assigned_date;
    const due = body.due_date === undefined ? record.due_date : body.due_date;
    this.validateDates(assigned, due, today);
    const points = actor === 'parent' && body.points !== undefined ? validatePoints(body.points) : record.points;
    const task = record.task;
    const taskOpen = task && record.task_state === 'open';
    if (task && (assigned !== record.assigned_date || due !== record.due_date)) {
      if (!taskOpen) throw fail(409, '任务已完成、已跳过或已过截止日期，不能再修改日期');
      if (!due || due < today) throw fail(400, '已生成任务的作业，截止日期不能早于今天');
      if (due < task.date) throw fail(400, `截止日期不能早于任务开始的日子（${task.date}）`);
    }
    this.db.transaction(() => {
      this.db.prepare('UPDATE homework_records SET content = ?, assigned_date = ?, due_date = ?, points = ?, priority = ?, updated_at = ? WHERE id = ?')
        .run(content, assigned, due, points, priority, new Date().toISOString(), id);
      if (taskOpen) {
        const title = taskTitle({ ...record, content });
        this.db.prepare('UPDATE daily_tasks SET title = ?, points = ?, due_date = ?, priority = ? WHERE id = ? AND is_completed = 0')
          .run(title, points, due > task.date ? due : null, priority, task.id);
      }
    })();
    return this.get(id);
  }

  // With delete_task, a parent also removes the record's task (and the points it earned).
  delete(id, { delete_task = false } = {}, actor) {
    const record = this.get(id);
    this.requireEditable(record, actor);
    this.db.transaction(() => {
      if (record.task && this.studyService) {
        const active = this.db.prepare('SELECT id FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(record.task.id);
        if (active) this.studyService.finish(id, active.id, {}, 'parent');
      }
      if (!delete_task && record.task) {
        // Future ordinary-task timing starts fresh; earlier study time stays in its sessions/legacy snapshot.
        this.db.prepare('UPDATE daily_tasks SET duration_seconds = NULL, duration_source = NULL, timer_started_at = NULL, timer_elapsed_seconds = 0 WHERE id = ?').run(record.task.id);
      }
      this.db.prepare('DELETE FROM homework_records WHERE id = ?').run(id);
      if (delete_task && record.task) this.tasksService.deleteAdhocTask(record.task.id);
    })();
    return { success: true, id };
  }

  // --- Default points per course ---

  setCoursePoints(courseKeyValue, points) {
    if (typeof courseKeyValue !== 'string' || !/^(school:.{1,10}|class:.+)$/.test(courseKeyValue)) throw fail(400, '课程无效');
    if (courseKeyValue.startsWith('class:') && !this.db.prepare('SELECT id FROM outside_classes WHERE id = ?').get(courseKeyValue.slice(6))) {
      throw fail(404, '课外班不存在');
    }
    validatePoints(points);
    this.db.prepare('INSERT INTO homework_course_points (course_key, points) VALUES (?, ?) ON CONFLICT(course_key) DO UPDATE SET points = excluded.points')
      .run(courseKeyValue, points);
    return { course_key: courseKeyValue, points };
  }

  // The homework a board task came from, for its card.
  homeworkByTask(childId) {
    return new Map(this.db.prepare('SELECT r.id, r.daily_task_id, r.subject, r.content, r.assigned_date, r.completion_requested_at, COALESCE(d.homework_legacy_seconds, 0) + COALESCE((SELECT SUM(duration_seconds) FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NOT NULL), 0) AS study_seconds, (SELECT COUNT(*) FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NOT NULL) AS study_count, EXISTS(SELECT 1 FROM homework_sessions s WHERE s.task_id = d.id AND s.ended_at IS NULL AND s.timer_started_at IS NOT NULL) AS study_running FROM homework_records r JOIN daily_tasks d ON d.id = r.daily_task_id WHERE r.child_id = ?')
      .all(childId).map(({ daily_task_id, ...record }) => [daily_task_id, record]));
  }
}

module.exports = HomeworkService;
module.exports.taskTitle = taskTitle;
