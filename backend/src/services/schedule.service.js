const { generateId } = require('../utils/crypto');
const { formatDate, getTodayDate, getDayOfWeek, getWeekRange, getDateRangeList, parseDate } = require('../utils/date');
const { classLessonKey } = require('../utils/schedule');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKS = ['all', 'A', 'B'];
const MAX_SLOTS = 20;
const MAX_SCHEDULE_DAYS = 42;
// Check-in tasks of outside classes are filed under this subject on the board.
const CLASS_TASK_SUBJECT = '其他';

const fail = (status, message) => ({ status, message });

// Optional (or required) short text; blank means none.
function text(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) throw fail(400, `请填写${label}`);
    return null;
  }
  if (typeof value !== 'string') throw fail(400, `${label}无效`);
  if (value.trim().length > max) throw fail(400, `${label}不超过 ${max} 个字`);
  return value.trim();
}

function validateDate(value, label) {
  try {
    if (typeof value !== 'string') throw new Error();
    parseDate(value);
  } catch {
    throw fail(400, `${label}必须为 YYYY-MM-DD`);
  }
  return value;
}

function validateTimes(start, end) {
  if (!TIME.test(start) || !TIME.test(end)) throw fail(400, '时间必须为 HH:MM');
  if (end <= start) throw fail(400, '结束时间必须晚于开始时间');
}

function validateDays(days) {
  if (!Array.isArray(days) || !days.length || !days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
    throw fail(400, '请至少选择一天');
  }
  return [...new Set(days)].sort();
}

// A or B for a date in a timetable with alternating weeks: the anchor's week is an A week.
function weekLabel(timetable, date) {
  if (!timetable.ab_weeks) return null;
  const weeks = Math.round((parseDate(getWeekRange(date).startDate) - parseDate(getWeekRange(timetable.ab_anchor_date).startDate)) / (7 * 86400000));
  return weeks % 2 === 0 ? 'A' : 'B';
}

// School timetables (per child and term) and outside classes (shared by any of the children), and
// what a child's days look like with them: the lessons, the classes, and what to bring.
class ScheduleService {
  constructor(db) {
    this.db = db;
  }

  requireChild(childId) {
    const child = this.db.prepare('SELECT id, created_at FROM children WHERE id = ?').get(childId);
    if (!child) throw fail(404, 'Child not found');
    return child;
  }

  // --- School timetables ---

  listTimetables(childId) {
    this.requireChild(childId);
    return this.db.prepare('SELECT * FROM timetables WHERE child_id = ? ORDER BY start_date DESC').all(childId)
      .map(row => this.describeTimetable(row));
  }

  getTimetable(id) {
    const row = this.db.prepare('SELECT * FROM timetables WHERE id = ?').get(id);
    return row ? this.describeTimetable(row) : null;
  }

  describeTimetable(row) {
    return {
      ...row,
      ab_weeks: Boolean(row.ab_weeks),
      slots: this.db.prepare('SELECT id, kind, label, start_time, end_time FROM timetable_slots WHERE timetable_id = ? ORDER BY start_time').all(row.id),
      lessons: this.db.prepare('SELECT id, slot_id, weekday, week, subject, teacher, room, bring FROM timetable_lessons WHERE timetable_id = ? ORDER BY weekday, rowid').all(row.id)
    };
  }

  createTimetable(childId, body) {
    this.requireChild(childId);
    const fields = this.validateTimetable(childId, body);
    const id = generateId();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO timetables (id, child_id, name, start_date, end_date, ab_weeks, ab_anchor_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, childId, fields.name, fields.start_date, fields.end_date, fields.ab_weeks ? 1 : 0, fields.ab_anchor_date, new Date().toISOString());
      this.saveDay(id, fields);
    })();
    return this.getTimetable(id);
  }

  // The whole timetable is saved at once: its slots and lessons replace the old ones.
  updateTimetable(id, body) {
    const existing = this.db.prepare('SELECT * FROM timetables WHERE id = ?').get(id);
    if (!existing) throw fail(404, '课程表不存在');
    const fields = this.validateTimetable(existing.child_id, body, id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE timetables SET name = ?, start_date = ?, end_date = ?, ab_weeks = ?, ab_anchor_date = ? WHERE id = ?')
        .run(fields.name, fields.start_date, fields.end_date, fields.ab_weeks ? 1 : 0, fields.ab_anchor_date, id);
      this.db.prepare('DELETE FROM timetable_slots WHERE timetable_id = ?').run(id);
      this.saveDay(id, fields);
    })();
    return this.getTimetable(id);
  }

  deleteTimetable(id) {
    if (!this.db.prepare('SELECT id FROM timetables WHERE id = ?').get(id)) throw fail(404, '课程表不存在');
    this.db.prepare('DELETE FROM timetables WHERE id = ?').run(id);
    return { success: true, id };
  }

  // Slots carry ids chosen by the client (new or existing); lessons point at them.
  saveDay(timetableId, { slots, lessons }) {
    const slotIds = new Map();
    const insertSlot = this.db.prepare('INSERT INTO timetable_slots (id, timetable_id, kind, label, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)');
    for (const slot of slots) {
      slotIds.set(slot.id, generateId());
      insertSlot.run(slotIds.get(slot.id), timetableId, slot.kind, slot.label, slot.start_time, slot.end_time);
    }
    const insertLesson = this.db.prepare(`INSERT INTO timetable_lessons (id, timetable_id, slot_id, weekday, week, subject, teacher, room, bring)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const lesson of lessons) {
      insertLesson.run(generateId(), timetableId, slotIds.get(lesson.slot_id), lesson.weekday, lesson.week, lesson.subject, lesson.teacher, lesson.room, lesson.bring);
    }
  }

  validateTimetable(childId, body, ignoreId = null) {
    const name = text(body.name, '课程表名称', 30, { required: true });
    const start = validateDate(body.start_date, '开始日期');
    const end = validateDate(body.end_date, '结束日期');
    if (end < start) throw fail(400, '结束日期不能早于开始日期');
    if (getDateRangeList(start, end).length > 366) throw fail(400, '课程表最长 366 天');
    // One timetable per day keeps "which lessons today" unambiguous.
    const overlap = this.db.prepare('SELECT name FROM timetables WHERE child_id = ? AND id != ? AND start_date <= ? AND end_date >= ?')
      .get(childId, ignoreId ?? '', end, start);
    if (overlap) throw fail(409, `与「${overlap.name}」的日期重叠`);

    const abWeeks = body.ab_weeks ?? false;
    if (typeof abWeeks !== 'boolean') throw fail(400, '单双周设置无效');
    const anchor = abWeeks ? validateDate(body.ab_anchor_date, '单双周的起始周') : null;

    if (!Array.isArray(body.slots) || !body.slots.length || body.slots.length > MAX_SLOTS) throw fail(400, `请设置 1 至 ${MAX_SLOTS} 个时段`);
    const slots = body.slots.map(slot => {
      if (!slot || typeof slot.id !== 'string' || !slot.id) throw fail(400, '时段无效');
      if (!['class', 'break'].includes(slot.kind)) throw fail(400, '时段类型无效');
      validateTimes(slot.start_time, slot.end_time);
      return { id: slot.id, kind: slot.kind, label: text(slot.label, '时段名称', 10, { required: true }), start_time: slot.start_time, end_time: slot.end_time };
    }).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (new Set(slots.map(slot => slot.id)).size !== slots.length) throw fail(400, '时段无效');
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].start_time < slots[i - 1].end_time) throw fail(400, `「${slots[i - 1].label}」和「${slots[i].label}」的时间重叠`);
    }

    const bySlot = new Map(slots.map(slot => [slot.id, slot]));
    const lessons = body.lessons ?? [];
    if (!Array.isArray(lessons) || lessons.length > MAX_SLOTS * 7 * 2) throw fail(400, '课程无效');
    const taken = new Map();
    const valid = lessons.map(lesson => {
      const slot = lesson && bySlot.get(lesson.slot_id);
      if (!slot || slot.kind !== 'class') throw fail(400, '课程所在的时段无效');
      if (!Number.isInteger(lesson.weekday) || lesson.weekday < 0 || lesson.weekday > 6) throw fail(400, '星期无效');
      const week = lesson.week ?? 'all';
      if (!WEEKS.includes(week) || (!abWeeks && week !== 'all')) throw fail(400, '单双周设置无效');
      // A slot on a weekday holds one lesson every week, or one each for A and B weeks.
      const key = `${lesson.slot_id}|${lesson.weekday}`;
      const weeks = taken.get(key) || [];
      if (weeks.includes(week) || (week === 'all' && weeks.length) || weeks.includes('all')) throw fail(400, `「${slot.label}」同一天排了两门课`);
      taken.set(key, [...weeks, week]);
      return {
        slot_id: lesson.slot_id, weekday: lesson.weekday, week,
        subject: text(lesson.subject, '科目', 10, { required: true }),
        teacher: text(lesson.teacher, '老师', 10),
        room: text(lesson.room, '教室', 20),
        bring: text(lesson.bring, '要带的东西', 30)
      };
    });
    return { name, start_date: start, end_date: end, ab_weeks: abWeeks, ab_anchor_date: anchor, slots, lessons: valid };
  }

  // --- Outside classes ---

  listClasses() {
    const assigned = new Map();
    for (const { class_id, child_id } of this.db.prepare('SELECT class_id, child_id FROM outside_class_children ORDER BY rowid').all()) {
      if (!assigned.has(class_id)) assigned.set(class_id, []);
      assigned.get(class_id).push(child_id);
    }
    return this.db.prepare('SELECT * FROM outside_classes ORDER BY start_time, created_at').all()
      .map(row => this.describeClass(row, assigned.get(row.id) || []));
  }

  getClass(id) {
    const row = this.db.prepare('SELECT * FROM outside_classes WHERE id = ?').get(id);
    if (!row) return null;
    return this.describeClass(row, this.db.prepare('SELECT child_id FROM outside_class_children WHERE class_id = ? ORDER BY rowid').all(id).map(r => r.child_id));
  }

  // Leave and moved lessons from a month ago on, so the parent sees what is coming and what just was.
  describeClass({ assign_all, ...row }, childIds) {
    const since = formatDate(new Date(Date.now() - 30 * 86400000));
    return {
      ...row,
      days_of_week: JSON.parse(row.days_of_week),
      create_task: Boolean(row.create_task),
      child_ids: assign_all ? null : childIds,
      exceptions: this.db.prepare(`SELECT * FROM outside_class_exceptions WHERE class_id = ? AND (date >= ? OR new_date >= ?)
        ORDER BY date`).all(row.id, since, since)
    };
  }

  createClass(body) {
    const fields = this.validateClass(body);
    const id = generateId();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO outside_classes (id, title, institution, location, teacher, days_of_week, start_time, end_time,
          start_date, end_date, bring, note, create_task, points, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, fields.title, fields.institution, fields.location, fields.teacher, JSON.stringify(fields.days_of_week), fields.start_time,
          fields.end_time, fields.start_date, fields.end_date, fields.bring, fields.note, fields.create_task ? 1 : 0, fields.points, new Date().toISOString());
      this.setClassChildren(id, fields.child_ids);
    })();
    return this.getClass(id);
  }

  updateClass(id, body) {
    const existing = this.getClass(id);
    if (!existing) throw fail(404, '课外班不存在');
    const fields = this.validateClass({ ...existing, ...body });
    this.db.transaction(() => {
      this.db.prepare(`UPDATE outside_classes SET title = ?, institution = ?, location = ?, teacher = ?, days_of_week = ?, start_time = ?,
          end_time = ?, start_date = ?, end_date = ?, bring = ?, note = ?, create_task = ?, points = ? WHERE id = ?`)
        .run(fields.title, fields.institution, fields.location, fields.teacher, JSON.stringify(fields.days_of_week), fields.start_time,
          fields.end_time, fields.start_date, fields.end_date, fields.bring, fields.note, fields.create_task ? 1 : 0, fields.points, id);
      this.setClassChildren(id, fields.child_ids);
      this.pruneClassTasks(id);
    })();
    return this.getClass(id);
  }

  // Done check-ins stay in the history (unlinked); ones still to do go with the class.
  deleteClass(id) {
    if (!this.db.prepare('SELECT id FROM outside_classes WHERE id = ?').get(id)) throw fail(404, '课外班不存在');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM daily_tasks WHERE class_id = ? AND is_completed = 0').run(id);
      this.db.prepare('DELETE FROM outside_classes WHERE id = ?').run(id);
    })();
    return { success: true, id };
  }

  setClassChildren(classId, childIds) {
    this.db.prepare('DELETE FROM outside_class_children WHERE class_id = ?').run(classId);
    this.db.prepare('UPDATE outside_classes SET assign_all = ? WHERE id = ?').run(childIds === null ? 1 : 0, classId);
    if (childIds === null) return;
    const insert = this.db.prepare('INSERT INTO outside_class_children (class_id, child_id) VALUES (?, ?)');
    for (const childId of childIds) {
      if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw fail(400, '指定的孩子不存在');
      insert.run(classId, childId);
    }
  }

  validateClass(body) {
    const title = text(body.title, '课程名称', 20, { required: true });
    const days = validateDays(body.days_of_week);
    validateTimes(body.start_time, body.end_time);
    const start = validateDate(body.start_date ?? getTodayDate(), '开始日期');
    const end = body.end_date ? validateDate(body.end_date, '结束日期') : null;
    if (end && end < start) throw fail(400, '结束日期不能早于开始日期');
    const createTask = body.create_task ?? false;
    if (typeof createTask !== 'boolean') throw fail(400, '“生成打卡任务”设置无效');
    const points = body.points ?? 5;
    if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw fail(400, '积分必须为 0 至 10000 的整数');
    const childIds = body.child_ids ?? null;
    if (childIds !== null && (!Array.isArray(childIds) || !childIds.length || !childIds.every(id => typeof id === 'string' && id))) {
      throw fail(400, '请至少选择一个孩子，或设为全部孩子');
    }
    return {
      title, days_of_week: days, start_time: body.start_time, end_time: body.end_time, start_date: start, end_date: end,
      institution: text(body.institution, '机构', 30),
      location: text(body.location, '地点', 50),
      teacher: text(body.teacher, '老师', 10),
      bring: text(body.bring, '要带的东西', 50),
      note: text(body.note, '备注', 100),
      create_task: createTask, points, child_ids: childIds === null ? null : [...new Set(childIds)]
    };
  }

  // --- Leave and moved lessons ---

  // One child's lesson on its usual date: on leave, or moved to another date and time. Setting it
  // again replaces the earlier change.
  setException(classId, body) {
    const cls = this.getClass(classId);
    if (!cls) throw fail(404, '课外班不存在');
    const childId = body.child_id;
    if (typeof childId !== 'string' || !(cls.child_ids === null ? this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId) : cls.child_ids.includes(childId))) {
      throw fail(400, '这个孩子没有这门课');
    }
    const date = validateDate(body.date, '日期');
    if (date < cls.start_date || (cls.end_date && date > cls.end_date) || !cls.days_of_week.includes(getDayOfWeek(date))) {
      throw fail(400, '这天没有这门课');
    }
    if (!['leave', 'moved'].includes(body.kind)) throw fail(400, '请选择请假或调课');
    let moved = { new_date: null, new_start_time: null, new_end_time: null };
    if (body.kind === 'moved') {
      validateTimes(body.new_start_time, body.new_end_time);
      moved = { new_date: validateDate(body.new_date, '调到的日期'), new_start_time: body.new_start_time, new_end_time: body.new_end_time };
      if (moved.new_date === date && moved.new_start_time === cls.start_time && moved.new_end_time === cls.end_time) throw fail(400, '调课后的时间和原来一样');
    }
    const note = text(body.note, '备注', 50);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO outside_class_exceptions (id, class_id, child_id, date, kind, new_date, new_start_time, new_end_time, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (class_id, child_id, date) DO UPDATE SET kind = excluded.kind, new_date = excluded.new_date,
          new_start_time = excluded.new_start_time, new_end_time = excluded.new_end_time, note = excluded.note`)
        .run(generateId(), classId, childId, date, body.kind, moved.new_date, moved.new_start_time, moved.new_end_time, note, new Date().toISOString());
      this.pruneClassTasks(classId);
    })();
    return this.getClass(classId);
  }

  // Back to the usual lesson.
  deleteException(id) {
    const exception = this.db.prepare('SELECT * FROM outside_class_exceptions WHERE id = ?').get(id);
    if (!exception) throw fail(404, '请假或调课记录不存在');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM outside_class_exceptions WHERE id = ?').run(id);
      this.pruneClassTasks(exception.class_id);
    })();
    return this.getClass(exception.class_id);
  }

  // Check-ins still to do whose lesson no longer happens that day (leave, moved away, schedule or
  // children changed, check-ins turned off) are dropped; done ones stay.
  pruneClassTasks(classId) {
    const rows = this.db.prepare('SELECT id, child_id, date, class_id, class_lesson_date FROM daily_tasks WHERE class_id = ? AND is_completed = 0').all(classId);
    const remove = this.db.prepare('DELETE FROM daily_tasks WHERE id = ?');
    const schedules = new Map();
    for (const row of rows) {
      if (!schedules.has(row.child_id)) schedules.set(row.child_id, this.classTaskSchedule(row.child_id));
      if (!schedules.get(row.child_id)(row.date).some(lesson => classLessonKey(lesson) === classLessonKey(row))) remove.run(row.id);
    }
  }

  // --- A child's days ---

  // For a child, a function telling a date's outside-class lessons: the usual ones (possibly on
  // leave or moved away, still listed so the board can say so) and lessons moved there.
  outsideLessons(childId) {
    const classes = this.db.prepare(`SELECT * FROM outside_classes c WHERE c.assign_all = 1
        OR EXISTS (SELECT 1 FROM outside_class_children WHERE class_id = c.id AND child_id = ?)`).all(childId)
      .map(row => ({ ...row, days: JSON.parse(row.days_of_week) }));
    const byId = new Map(classes.map(row => [row.id, row]));
    const exceptions = this.db.prepare('SELECT * FROM outside_class_exceptions WHERE child_id = ?').all(childId).filter(e => byId.has(e.class_id));
    const exceptionAt = new Map(exceptions.map(e => [`${e.class_id}|${e.date}`, e]));
    const movedInto = new Map();
    for (const e of exceptions.filter(e => e.kind === 'moved')) {
      if (!movedInto.has(e.new_date)) movedInto.set(e.new_date, []);
      movedInto.get(e.new_date).push(e);
    }
    const lesson = (row, date, startTime, endTime, status, e = null) => ({
      class_id: row.id, class_lesson_date: e?.date ?? date, date, title: row.title, institution: row.institution, location: row.location, teacher: row.teacher,
      bring: row.bring, note: row.note, start_time: startTime, end_time: endTime, status,
      exception_id: e?.id ?? null, exception_note: e?.note ?? null,
      moved_to: status === 'moved_out' ? { date: e.new_date, start_time: e.new_start_time, end_time: e.new_end_time } : null,
      moved_from: status === 'moved_in' ? e.date : null,
      create_task: Boolean(row.create_task), points: row.points, created_at: row.created_at
    });
    return date => {
      const weekday = getDayOfWeek(date);
      const list = [];
      for (const row of classes) {
        if (date < row.start_date || (row.end_date && date > row.end_date) || !row.days.includes(weekday)) continue;
        const e = exceptionAt.get(`${row.id}|${date}`);
        list.push(lesson(row, date, row.start_time, row.end_time, !e ? 'scheduled' : e.kind === 'leave' ? 'leave' : 'moved_out', e));
      }
      for (const e of movedInto.get(date) || []) list.push(lesson(byId.get(e.class_id), date, e.new_start_time, e.new_end_time, 'moved_in', e));
      return list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    };
  }

  // Lessons that are a check-in task that day: taking place, from classes that make check-ins, and
  // not before the class or the child existed (days before are never owed).
  classTaskSchedule(childId) {
    const child = this.db.prepare('SELECT created_at FROM children WHERE id = ?').get(childId);
    if (!child) return () => [];
    const childSince = formatDate(new Date(child.created_at));
    const lessonsOn = this.outsideLessons(childId);
    return date => date < childSince ? [] : lessonsOn(date)
      .filter(l => l.create_task && ['scheduled', 'moved_in'].includes(l.status) && date >= formatDate(new Date(l.created_at)))
      .map(l => ({ ...l, subject: CLASS_TASK_SUBJECT }));
  }

  // A child's days between two dates: school lessons (none on holidays), outside classes, and what
  // to bring. Breaks only show between lessons.
  schedule(childId, from, to) {
    this.requireChild(childId);
    validateDate(from, '开始日期');
    validateDate(to, '结束日期');
    if (to < from) throw fail(400, '结束日期不能早于开始日期');
    if (getDateRangeList(from, to).length > MAX_SCHEDULE_DAYS) throw fail(400, `最多查看 ${MAX_SCHEDULE_DAYS} 天`);
    const timetables = this.db.prepare('SELECT * FROM timetables WHERE child_id = ? AND start_date <= ? AND end_date >= ?').all(childId, to, from)
      .map(row => this.describeTimetable(row));
    const periods = this.db.prepare('SELECT name, start_date, end_date FROM periods WHERE child_id = ? AND start_date <= ? AND end_date >= ?').all(childId, to, from);
    const lessonsOn = this.outsideLessons(childId);
    return getDateRangeList(from, to).map(date => {
      const weekday = getDayOfWeek(date);
      const holiday = periods.find(p => p.start_date <= date && p.end_date >= date)?.name ?? null;
      const timetable = timetables.find(t => t.start_date <= date && t.end_date >= date) ?? null;
      const week = timetable ? weekLabel(timetable, date) : null;
      let school = [];
      if (timetable && !holiday) {
        school = timetable.slots.map(slot => {
          if (slot.kind === 'break') return { ...slot };
          const lesson = timetable.lessons.find(l => l.slot_id === slot.id && l.weekday === weekday && (l.week === 'all' || l.week === week));
          return lesson ? { ...slot, subject: lesson.subject, teacher: lesson.teacher, room: lesson.room, bring: lesson.bring, week: lesson.week } : null;
        }).filter(Boolean);
        const first = school.findIndex(item => item.kind === 'class');
        const last = school.findLastIndex(item => item.kind === 'class');
        school = first === -1 ? [] : school.slice(first, last + 1);
      }
      const outside = lessonsOn(date);
      const bring = [];
      for (const item of [...school.filter(s => s.kind === 'class').map(s => ({ for: s.subject, items: s.bring })),
        ...outside.filter(l => ['scheduled', 'moved_in'].includes(l.status)).map(l => ({ for: l.title, items: l.bring }))]) {
        if (item.items && !bring.some(b => b.for === item.for && b.items === item.items)) bring.push(item);
      }
      return { date, weekday, timetable_name: timetable?.name ?? null, week, holiday, school, outside, bring };
    });
  }
}

module.exports = ScheduleService;
module.exports.CLASS_TASK_SUBJECT = CLASS_TASK_SUBJECT;
