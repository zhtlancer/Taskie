const { formatDate, getTodayDate, getDayOfWeek, parseDate, shiftDate } = require('../utils/date');
const { timeZone } = require('../config');
const { generateId } = require('../utils/crypto');
const fail = (status, message) => ({ status, message });
const minutes = (start, end) => start && end ? (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) : null;
const isDue = (date, end, today, clock) => date < today || date === today && (!end || end <= clock);

// Stable identity is class + child + original lesson date. Moves never create a second credit.
// Summary arithmetic avoids walking an unlimited weekly course's entire history.
class ClassStatsService {
  constructor(db, schedule) { this.db = db; this.schedule = schedule; }
  context(classId, childId, allowEmpty = false) {
    const cls = this.schedule.getClass(classId);
    if (!cls) throw fail(404, '课外班不存在');
    const child = this.db.prepare('SELECT created_at FROM children WHERE id = ?').get(childId);
    if (!child) throw fail(404, '孩子不存在');
    const records = this.db.prepare('SELECT * FROM outside_class_attendance WHERE class_id = ? AND child_id = ?').all(classId, childId);
    const fee = this.db.prepare('SELECT total_fee_cents, updated_at FROM outside_class_fees WHERE class_id = ? AND child_id = ?').get(classId, childId);
    const enrolled = cls.child_ids === null || cls.child_ids.includes(childId);
    if (!allowEmpty && !enrolled && !records.length && !fee) throw fail(400, '这个孩子没有这门课');
    const exceptions = new Map(this.db.prepare('SELECT * FROM outside_class_exceptions WHERE class_id = ? AND child_id = ?').all(classId, childId)
      .filter(e => this.validSource(cls, e.date)).map(e => [e.date, e]));
    // Like check-in tasks, lessons before the child or the class existed are never owed; nor are
    // lessons before attendance tracking began. They can still be recorded, just not counted pending.
    const tracking = this.db.prepare("SELECT value FROM settings WHERE key = 'class_attendance_since'").get()?.value;
    const since = [cls.start_date, formatDate(new Date(child.created_at)), formatDate(new Date(cls.created_at)), tracking].filter(Boolean).sort().at(-1);
    return { cls, childId, enrolled, since, hasFeeRow: Boolean(fee), records: new Map(records.map(r => [r.lesson_date, r])), fee: fee?.total_fee_cents ?? null, feeUpdatedAt: fee?.updated_at ?? null, exceptions };
  }
  validSource(cls, date) {
    return date >= cls.start_date && (!cls.end_date || date <= cls.end_date) && cls.days_of_week.includes(getDayOfWeek(date));
  }
  countThrough(cls, date) {
    const end = cls.end_date && cls.end_date < date ? cls.end_date : date;
    if (end < cls.start_date) return 0;
    const days = Math.round((parseDate(end) - parseDate(cls.start_date)) / 86400000) + 1;
    const weekday = getDayOfWeek(cls.start_date);
    return cls.days_of_week.reduce((n, day) => {
      const offset = (day - weekday + 7) % 7;
      return n + (offset >= days ? 0 : 1 + Math.floor((days - 1 - offset) / 7));
    }, 0);
  }
  lesson(ctx, source) {
    const { cls, records, exceptions } = ctx;
    const record = records.get(source);
    const e = exceptions.get(source);
    const actual = e?.kind === 'moved' ? e.new_date : source;
    return {
      lesson_date: source, actual_date: record?.actual_date ?? actual,
      start_time: record ? record.start_time : e?.new_start_time ?? cls.start_time,
      end_time: record ? record.end_time : e?.new_end_time ?? cls.end_time,
      duration_minutes: record ? record.duration_minutes : minutes(e?.new_start_time ?? cls.start_time, e?.new_end_time ?? cls.end_time),
      status: record?.status ?? (e?.kind === 'leave' ? 'leave' : 'pending'),
      charged: Boolean(record?.charged), source: record?.source ?? null,
      note: record?.note ?? e?.note ?? '',
      lesson_number: cls.total_lessons && this.validSource(cls, source) ? this.countThrough(cls, source) : null,
      historical: !this.validSource(cls, source), confirmed: Boolean(record),
      // The version a parent edits; a save based on an older one is refused.
      updated_at: record?.updated_at ?? null
    };
  }
  datesIn(cls, from, to) {
    const start = from > cls.start_date ? from : cls.start_date;
    const end = cls.end_date && cls.end_date < to ? cls.end_date : to;
    if (start > end) return [];
    const dates = [];
    const weekday = getDayOfWeek(start);
    for (const day of cls.days_of_week) {
      for (let at = shiftDate(start, (day - weekday + 7) % 7); at <= end; at = shiftDate(at, 7)) dates.push(at);
    }
    return dates.sort();
  }
  now() {
    return { today: getTodayDate(), clock: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) };
  }
  summary(ctx) {
    const { cls, childId, records, exceptions, since } = ctx;
    const { today, clock } = this.now();
    let due = Math.max(0, this.countThrough(cls, shiftDate(today, -1)) - this.countThrough(cls, shiftDate(since, -1)));
    if (this.validSource(cls, today) && today >= since && cls.end_time <= clock) due++;
    let confirmedDue = 0, attended = 0, absent = 0, leave = 0, charged = 0, knownMinutes = 0, unknownDuration = 0, monthAttended = 0;
    // Only overrides need special handling; all other past scheduled dates stay unconfirmed.
    for (const source of new Set([...exceptions.keys(), ...records.keys()])) {
      // Remove the original date only if it was in the base count, then place the lesson by its
      // actual date. Its original date remains the identity even when a move crosses `since`.
      if (source >= since && this.validSource(cls, source) && isDue(source, cls.end_time, today, clock)) due--;
      const lesson = this.lesson(ctx, source);
      const elapsed = isDue(lesson.actual_date, lesson.end_time, today, clock);
      if (lesson.status === 'leave') leave++;
      else if (elapsed && lesson.actual_date >= since) { due++; if (lesson.status !== 'pending') confirmedDue++; }
      if (lesson.status === 'attended') {
        attended++;
        if (lesson.actual_date.slice(0, 7) === today.slice(0, 7)) monthAttended++;
        if (lesson.duration_minutes === null) unknownDuration++;
        else knownMinutes += lesson.duration_minutes;
      }
      if (lesson.status === 'absent') absent++;
      if (lesson.charged) charged++;
    }
    const searchStart = cls.start_date > today ? cls.start_date : today;
    // Each overridden source can skip at most one regular lesson; this always reaches the next
    // ordinary lesson even after several consecutive weeks of leave.
    const futureSources = new Set(this.datesIn(cls, searchStart, shiftDate(searchStart, 7 * (records.size + exceptions.size + 2))));
    for (const [source, e] of exceptions) if (e.kind === 'moved' && e.new_date >= today) futureSources.add(source);
    const next = [...futureSources].map(source => this.lesson(ctx, source))
      .filter(l => l.status === 'pending' && !isDue(l.actual_date, l.end_time, today, clock))
      .sort((a, b) => a.actual_date.localeCompare(b.actual_date) || a.start_time.localeCompare(b.start_time))[0] ?? null;
    let estimatedEnd = cls.end_date;
    if (estimatedEnd) for (const [source, e] of exceptions) {
      const actual = this.lesson(ctx, source).actual_date;
      if (e.kind === 'moved' && actual > estimatedEnd) estimatedEnd = actual;
    }
    const total = cls.total_lessons ?? null;
    const consumed = total && ctx.fee !== null ? Math.round(ctx.fee * charged / total) : null;
    return { class_id: cls.id, child_id: childId, title: cls.title, enrolled: ctx.enrolled,
      available: Boolean(ctx.enrolled || records.size || ctx.hasFeeRow), total_lessons: total,
      attended, absent, leave, pending: ctx.enrolled ? Math.max(0, due - confirmedDue) : 0, pending_since: since, charged_lessons: charged,
      remaining_credits: total === null ? null : Math.max(0, total - charged),
      attendance_rate: attended + absent ? Math.round(attended * 100 / (attended + absent)) : null,
      attended_minutes: knownMinutes, unknown_duration_lessons: unknownDuration, month_attended: monthAttended,
      next_lesson: ctx.enrolled ? next : null, estimated_end_date: estimatedEnd, total_fee_cents: ctx.fee, fee_updated_at: ctx.feeUpdatedAt,
      per_lesson_cents: total && ctx.fee !== null ? ctx.fee / total : null,
      consumed_cents: consumed, remaining_cents: consumed === null ? null : Math.max(0, ctx.fee - consumed),
      overdrawn_lessons: total === null ? 0 : Math.max(0, charged - total), today, time_zone: timeZone };
  }
  list(childId) {
    if (!this.db.prepare('SELECT 1 FROM children WHERE id = ?').get(childId)) throw fail(404, '孩子不存在');
    return this.schedule.listClasses().filter(cls => cls.child_ids === null || cls.child_ids.includes(childId) ||
      this.db.prepare('SELECT 1 FROM outside_class_attendance WHERE class_id = ? AND child_id = ? UNION SELECT 1 FROM outside_class_fees WHERE class_id = ? AND child_id = ?').get(cls.id, childId, cls.id, childId))
      .map(cls => this.summary(this.context(cls.id, childId)));
  }
  details(classId, childId, from, to) {
    const ctx = this.context(classId, childId), summary = this.summary(ctx);
    from = from ?? shiftDate(summary.today, -30); to = to ?? shiftDate(summary.today, 30);
    parseDate(from); parseDate(to);
    if (to < from || parseDate(to) - parseDate(from) > 92 * 86400000) throw fail(400, '每次查看的日期范围须在 93 天以内');
    const sources = new Set(this.datesIn(ctx.cls, from, to));
    for (const [source, e] of ctx.exceptions) if (e.kind === 'moved' && e.new_date >= from && e.new_date <= to) sources.add(source);
    for (const [source, r] of ctx.records) if (r.actual_date >= from && r.actual_date <= to) sources.add(source);
    const lessons = [...sources].map(source => this.lesson(ctx, source)).filter(l => l.actual_date >= from && l.actual_date <= to)
      .sort((a, b) => a.actual_date.localeCompare(b.actual_date) || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.lesson_date.localeCompare(b.lesson_date));
    const changes = this.db.prepare(`SELECT kind, lesson_date, old_value, new_value, created_at FROM outside_class_changes
      WHERE class_id = ? AND child_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20`).all(classId, childId)
      .map(row => ({ ...row, old_value: JSON.parse(row.old_value), new_value: JSON.parse(row.new_value) }));
    return { summary, from, to, lessons, changes };
  }
  // Saves carry the updated_at they were based on (null for no record yet). Two parents editing
  // the same lesson or fee cannot silently replace each other: the later save gets a 409.
  checkVersion(current, expected, message) {
    if (expected !== undefined && (current ?? null) !== expected) throw fail(409, message);
  }
  recordChange(classId, childId, kind, lessonDate, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.db.prepare(`INSERT INTO outside_class_changes(id, class_id, child_id, kind, lesson_date, old_value, new_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(generateId(), classId, childId, kind, lessonDate, JSON.stringify(before), JSON.stringify(after), new Date().toISOString());
  }
  setAttendance(classId, childId, source, body) {
    parseDate(source);
    const ctx = this.context(classId, childId);
    if (!ctx.records.has(source) && (!ctx.enrolled || !this.validSource(ctx.cls, source))) throw fail(400, '这天没有这门课');
    const lesson = this.lesson(ctx, source);
    if (!['attended', 'leave', 'absent', 'pending'].includes(body.status)) throw fail(400, '请选择已上课、请假、缺席或未确认');
    if (body.status !== 'pending' && lesson.actual_date > getTodayDate()) throw fail(400, '未来的课程请通过请假或调课安排，不能提前确认出勤');
    if (body.charged !== undefined && typeof body.charged !== 'boolean') throw fail(400, '是否消课必须为是或否');
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 200)) throw fail(400, '备注不超过 200 个字');
    const attendanceOf = row => (row ? { status: row.status, charged: Boolean(row.charged), note: row.note } : null);
    this.db.transaction(() => {
      const before = this.db.prepare('SELECT * FROM outside_class_attendance WHERE class_id = ? AND child_id = ? AND lesson_date = ?').get(classId, childId, source);
      this.checkVersion(before?.updated_at, body.expected_updated_at, '这节课的出勤刚被其他设备修改过，请看最新记录后再改');
      if (body.status === 'pending') this.db.prepare('DELETE FROM outside_class_attendance WHERE class_id = ? AND child_id = ? AND lesson_date = ?').run(classId, childId, source);
      else this.db.prepare(`INSERT INTO outside_class_attendance
        (class_id, child_id, lesson_date, actual_date, start_time, end_time, duration_minutes, status, charged, source, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent', ?, ?)
        ON CONFLICT(class_id, child_id, lesson_date) DO UPDATE SET status = excluded.status, charged = excluded.charged,
          source = 'parent', task_id = NULL, note = excluded.note, updated_at = excluded.updated_at`)
        .run(classId, childId, source, lesson.actual_date, lesson.start_time, lesson.end_time, lesson.duration_minutes,
          body.status, (body.charged ?? body.status === 'attended') ? 1 : 0, body.note?.trim() ?? '', new Date().toISOString());
      const after = this.db.prepare('SELECT * FROM outside_class_attendance WHERE class_id = ? AND child_id = ? AND lesson_date = ?').get(classId, childId, source);
      this.recordChange(classId, childId, 'attendance', source, attendanceOf(before), attendanceOf(after));
      this.schedule.pruneClassTasks(classId);
    })();
    return this.summary(this.context(classId, childId, true));
  }
  setFee(classId, childId, body) {
    this.context(classId, childId);
    const amount = body.total_fee_cents;
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000)) throw fail(400, '学费须为 0 至 1000 万元，最多两位小数；不填时传 null');
    this.db.transaction(() => {
      const before = this.db.prepare('SELECT total_fee_cents, updated_at FROM outside_class_fees WHERE class_id = ? AND child_id = ?').get(classId, childId);
      this.checkVersion(before?.updated_at, body.expected_updated_at, '学费刚被其他设备修改过，请看最新金额后再改');
      if (amount === null) this.db.prepare('DELETE FROM outside_class_fees WHERE class_id = ? AND child_id = ?').run(classId, childId);
      else this.db.prepare(`INSERT INTO outside_class_fees(class_id, child_id, total_fee_cents, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(class_id, child_id) DO UPDATE SET total_fee_cents = excluded.total_fee_cents, updated_at = excluded.updated_at`)
        .run(classId, childId, amount, new Date().toISOString());
      this.recordChange(classId, childId, 'fee', null, before?.total_fee_cents ?? null, amount);
    })();
    return this.summary(this.context(classId, childId, true));
  }
  syncCheckin(task) {
    if (task.origin !== 'class' || !task.class_id) return;
    const lesson = this.schedule.outsideLessons(task.child_id)(task.date).find(l => l.class_id === task.class_id && l.class_lesson_date === (task.class_lesson_date ?? task.date) && ['scheduled', 'moved_in'].includes(l.status));
    this.db.prepare(`INSERT INTO outside_class_attendance
      (class_id, child_id, lesson_date, actual_date, start_time, end_time, duration_minutes, status, charged, source, task_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'attended', 1, 'checkin', ?, ?)
      ON CONFLICT(class_id, child_id, lesson_date) DO UPDATE SET status = 'attended', charged = 1, task_id = excluded.task_id, updated_at = excluded.updated_at
      WHERE outside_class_attendance.source = 'checkin'`)
      .run(task.class_id, task.child_id, task.class_lesson_date ?? task.date, task.date, lesson?.start_time ?? null, lesson?.end_time ?? null,
        lesson ? minutes(lesson.start_time, lesson.end_time) : null, task.id, new Date().toISOString());
  }
  undoCheckin(taskId) {
    const record = this.db.prepare("SELECT * FROM outside_class_attendance WHERE task_id = ? AND source = 'checkin'").get(taskId);
    if (!record) return;
    this.db.prepare("DELETE FROM outside_class_attendance WHERE task_id = ? AND source = 'checkin'").run(taskId);
    // Legacy databases may contain duplicate check-ins for one original lesson. Undoing one
    // cannot erase the evidence of another still-completed check-in for that same lesson.
    const other = this.db.prepare(`SELECT * FROM daily_tasks WHERE class_id = ? AND child_id = ?
      AND COALESCE(class_lesson_date, date) = ? AND is_completed = 1 AND id != ?
      ORDER BY completed_at DESC, rowid DESC LIMIT 1`).get(record.class_id, record.child_id, record.lesson_date, taskId);
    if (other) this.syncCheckin(other);
  }
}
module.exports = ClassStatsService;
