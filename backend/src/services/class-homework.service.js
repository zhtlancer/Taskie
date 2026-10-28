const { getTodayDate, shiftDate } = require('../utils/date');
const { MAX_CARRY_DAYS } = require('./calendar');

class ClassHomeworkService {
  constructor(db, schedule, homework) { Object.assign(this, { db, schedule, homework }); }

  result(row, created = false) {
    return row ? { record_id: row.homework_id, task_id: row.daily_task_id ?? null, due_date: row.due_date ?? null,
      state: !row.homework_id ? 'deleted' : row.daily_task_id ? 'task' : 'record', created } : null;
  }

  records(childId) {
    return this.db.prepare(`SELECT a.*, r.daily_task_id, r.due_date FROM outside_class_homework a
      LEFT JOIN homework_records r ON r.id = a.homework_id WHERE a.child_id = ?`).all(childId);
  }

  get(classId, childId, source) {
    return this.db.prepare(`SELECT a.*, r.daily_task_id, r.due_date FROM outside_class_homework a
      LEFT JOIN homework_records r ON r.id = a.homework_id WHERE a.class_id = ? AND a.child_id = ? AND a.lesson_date = ?`).get(classId, childId, source) ?? null;
  }

  nextDate(attendance) {
    const lessonsOn = this.schedule.outsideLessons(attendance.child_id, { forWrite: true });
    for (let offset = 0; offset <= MAX_CARRY_DAYS; offset++) {
      const date = shiftDate(attendance.actual_date, offset);
      const next = lessonsOn(date).find(lesson => lesson.class_id === attendance.class_id &&
        lesson.class_lesson_date !== attendance.lesson_date && ['scheduled', 'moved_in'].includes(lesson.status) &&
        lesson.attendance?.status !== 'leave' && (offset > 0 || attendance.start_time && lesson.start_time > attendance.start_time));
      if (next) return date;
    }
    return null;
  }

  ensure(classId, childId, source) {
    return this.db.transaction(() => {
      const attendance = this.db.prepare('SELECT * FROM outside_class_attendance WHERE class_id = ? AND child_id = ? AND lesson_date = ?').get(classId, childId, source);
      const cls = this.schedule.getClass(classId);
      if (!cls?.auto_homework || attendance?.status !== 'attended') return null;
      const existing = this.get(classId, childId, source);
      if (existing) return this.result(existing);
      const due = this.nextDate(attendance);
      const today = getTodayDate();
      const date = attendance.actual_date;
      const record = this.homework.createRecord(childId, {
        assigned_date: date, due_date: due,
        content: `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日“${cls.title}”作业`,
        create_task: Boolean(due && due >= today)
      }, 'parent', { kind: 'class', subject: cls.title, class_id: classId });
      this.db.prepare(`INSERT INTO outside_class_homework(class_id, child_id, lesson_date, actual_date, homework_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(classId, childId, source, date, record.id, new Date().toISOString());
      return this.result({ homework_id: record.id, daily_task_id: record.daily_task_id, due_date: record.due_date }, true);
    })();
  }
}
module.exports = ClassHomeworkService;
