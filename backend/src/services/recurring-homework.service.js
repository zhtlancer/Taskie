const { generateId } = require('../utils/crypto');
const { getTodayDate, getDayOfWeek, getWeekRange, shiftDate, parseDate } = require('../utils/date');
const { validateTiming } = require('../utils/timer');
const { validatePriority } = require('../utils/priority');
const { editVersion, requireEditVersion } = require('../utils/edit-version');
const { schoolCalendar } = require('./calendar');
const fail = (status, message) => ({ status, message });
const fields = ['subject', 'weekday', 'start_date', 'end_date', 'points', 'priority', 'track_time', 'expected_minutes', 'pause_on_holidays', 'enabled'];

class RecurringHomeworkService {
  constructor(db, homework, skips) { Object.assign(this, { db, homework, skips }); }

  get(id) {
    const row = this.db.prepare('SELECT * FROM recurring_homework_templates WHERE id = ?').get(id);
    if (!row) throw fail(404, '周期作业模板不存在');
    for (const key of ['track_time', 'pause_on_holidays', 'enabled']) row[key] = Boolean(row[key]);
    return { ...row, edit_version: editVersion(fields.map(key => row[key])) };
  }

  validate(body) {
    if (typeof body.subject !== 'string' || !body.subject.trim() || body.subject.trim().length > 10) throw fail(400, '课程名称应为 1 至 10 个字');
    if (!Number.isSafeInteger(body.weekday) || body.weekday < 0 || body.weekday > 6) throw fail(400, '请选择每周生成日');
    parseDate(body.start_date);
    const end = body.end_date ?? null;
    if (end !== null) { parseDate(end); if (end < body.start_date) throw fail(400, '结束日期不能早于开始日期'); }
    const points = body.points ?? 10;
    if (!Number.isSafeInteger(points) || points < 0 || points > 10000) throw fail(400, '积分必须为 0 至 10000 的整数');
    const booleans = { enabled: body.enabled === undefined ? true : body.enabled, pause_on_holidays: body.pause_on_holidays === undefined ? false : body.pause_on_holidays };
    for (const value of Object.values(booleans)) if (typeof value !== 'boolean') throw fail(400, '周期作业开关设置无效');
    return { subject: body.subject.trim(), weekday: body.weekday, start_date: body.start_date, end_date: end, points,
      priority: validatePriority(body.priority), ...validateTiming(body), ...booleans };
  }

  create(childId, body) {
    this.homework.requireChild(childId);
    const values = this.validate(body), id = generateId(), now = new Date().toISOString();
    this.db.prepare(`INSERT INTO recurring_homework_templates (id, child_id, ${fields.join(', ')}, created_at, updated_at)
      VALUES (${Array(fields.length + 4).fill('?').join(', ')})`).run(id, childId,
      ...fields.map(key => typeof values[key] === 'boolean' ? Number(values[key]) : values[key]), now, now);
    this.ensure(childId);
    return this.get(id);
  }

  update(id, body) {
    const old = this.get(id);
    requireEditVersion(body.expected_version, old.edit_version);
    const values = this.validate({ ...old, ...body });
    this.db.prepare(`UPDATE recurring_homework_templates SET ${fields.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...fields.map(key => typeof values[key] === 'boolean' ? Number(values[key]) : values[key]), new Date().toISOString(), id);
    this.ensure(old.child_id);
    return this.get(id);
  }

  remove(id, body) {
    requireEditVersion(body.expected_version, this.get(id).edit_version);
    this.db.prepare('DELETE FROM recurring_homework_templates WHERE id = ?').run(id);
    return { success: true };
  }

  latestDate(template, today = getTodayDate()) {
    const anchor = template.end_date && template.end_date < today ? template.end_date : today;
    return shiftDate(anchor, -((getDayOfWeek(anchor) - template.weekday + 7) % 7));
  }

  periodDate(template) {
    const current = this.occurrence(template.id, getTodayDate());
    if (current) return current.scheduled_date;
    const thisWeek = shiftDate(getWeekRange().startDate, (template.weekday + 6) % 7);
    if (thisWeek >= template.start_date) return thisWeek;
    return shiftDate(template.start_date, (template.weekday - getDayOfWeek(template.start_date) + 7) % 7);
  }

  occurrence(templateId, date) {
    return this.db.prepare('SELECT * FROM recurring_homework_occurrences WHERE template_id = ? AND cycle_start = ?')
      .get(templateId, getWeekRange(date).startDate) ?? null;
  }

  list(childId) {
    this.homework.requireChild(childId);
    this.ensure(childId);
    return this.db.prepare('SELECT id FROM recurring_homework_templates WHERE child_id = ? ORDER BY created_at, id').all(childId).map(({ id }) => {
      const template = this.get(id), date = this.periodDate(template);
      return { ...template, period_date: date, occurrence: this.occurrence(id, date) };
    });
  }

  // Only the newest weekly occurrence is considered, including after downtime. The record may
  // refer to a past assignment date, but its task begins today; unopened past boards stay intact.
  ensure(childId) {
    const today = getTodayDate(), calendar = schoolCalendar(this.db, childId);
    this.db.transaction(() => {
      for (const template of this.db.prepare('SELECT * FROM recurring_homework_templates WHERE child_id = ? AND enabled = 1').all(childId)) {
        const date = this.latestDate(template, today);
        if (date < template.start_date || shiftDate(date, 7) < today || this.occurrence(template.id, date) ||
          this.db.prepare('SELECT 1 FROM recurring_homework_occurrences WHERE template_id = ? AND cycle_start > ? AND scheduled_date <= ?')
            .get(template.id, getWeekRange(date).startDate, today)) continue;
        const title = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日·${template.subject}作业`;
        const skipped = Boolean(template.pause_on_holidays && calendar.holidayOn(date));
        let homeworkId = null;
        if (!skipped) {
          const record = this.homework.createRecord(childId, {
            content: '', assigned_date: date, due_date: shiftDate(date, 7), create_task: true,
            points: template.points, priority: template.priority, track_time: Boolean(template.track_time), expected_minutes: template.expected_minutes
          }, 'parent', { kind: 'school', subject: template.subject, class_id: null }, { recurringTitle: title, contentPending: true });
          homeworkId = record.id;
        }
        this.db.prepare(`INSERT INTO recurring_homework_occurrences (template_id, child_id, cycle_start, scheduled_date, title, homework_id, skipped, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(template.id, childId, getWeekRange(date).startDate, date, title, homeworkId, Number(skipped), new Date().toISOString());
      }
    })();
  }

  skip(id, body) {
    const template = this.get(id);
    requireEditVersion(body.expected_version, template.edit_version);
    const date = this.periodDate(template);
    if (body.date !== date || template.end_date && date > template.end_date) throw fail(409, '本期日期已变化，请刷新后再操作');
    return this.db.transaction(() => {
      const occurrence = this.occurrence(id, date);
      if (occurrence?.skipped) return { success: true };
      if (occurrence?.homework_id) {
        const record = this.homework.get(occurrence.homework_id);
        if (record.task?.is_completed) throw fail(409, '本期作业已完成，保留原记录');
        if (record.task && !record.task.is_skipped) this.skips.requestSkip(record.task.id, '本期停课或没有作业', { role: 'parent' });
      }
      if (occurrence) this.db.prepare('UPDATE recurring_homework_occurrences SET skipped = 1 WHERE template_id = ? AND cycle_start = ?').run(id, occurrence.cycle_start);
      else this.db.prepare(`INSERT INTO recurring_homework_occurrences (template_id, child_id, cycle_start, scheduled_date, title, skipped, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)`).run(id, template.child_id, getWeekRange(date).startDate, date, `${template.subject}作业`, new Date().toISOString());
      return { success: true };
    })();
  }
}

module.exports = RecurringHomeworkService;
