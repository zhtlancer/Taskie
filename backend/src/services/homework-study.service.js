const { generateId } = require('../utils/crypto');
const { getTodayDate, formatDate, parseDate } = require('../utils/date');
const MAX_SECONDS = 12 * 3600;
const fail = (status, message) => ({ status, message });

// Split elapsed seconds at the family's actual midnight, including DST and non-UTC time zones.
function splitSeconds(startedAt, seconds) {
  let at = Math.floor(Date.parse(startedAt) / 1000);
  const days = [];
  while (seconds > 0) {
    const date = formatDate(new Date(at * 1000));
    let size = seconds;
    if (formatDate(new Date((at + seconds - 1) * 1000)) !== date) {
      let lo = 1, hi = seconds;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (formatDate(new Date((at + mid) * 1000)) === date) lo = mid + 1;
        else hi = mid;
      }
      size = lo;
    }
    days.push({ date, seconds: size });
    at += size; seconds -= size;
  }
  return days;
}

class HomeworkStudyService {
  constructor(db, homework, tasks, timers) { Object.assign(this, { db, homework, tasks, timers }); }

  task(recordId) {
    const record = this.homework.get(recordId);
    if (!record.task) throw fail(409, '请先由家长生成打卡任务');
    const task = this.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(record.task.id);
    return { record, task };
  }

  session(taskId, id) {
    const row = this.db.prepare('SELECT * FROM homework_sessions WHERE id = ? AND task_id = ?').get(id, taskId);
    if (!row) throw fail(404, '学习记录不存在');
    return row;
  }

  describe(row) {
    const running = row.timer_started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(row.timer_started_at)) / 1000)) : 0;
    return { ...row, timer_seconds: Math.min(MAX_SECONDS, row.duration_seconds + running),
      days: this.db.prepare('SELECT date, seconds FROM homework_session_days WHERE session_id = ? ORDER BY date').all(row.id) };
  }

  details(recordId) {
    const { record, task } = this.task(recordId);
    const rows = this.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ? ORDER BY started_at DESC, rowid DESC').all(task.id);
    return { record, legacy_seconds: task.homework_legacy_seconds || 0,
      total_seconds: (task.homework_legacy_seconds || 0) + rows.filter(r => r.ended_at).reduce((n, r) => n + r.duration_seconds, 0),
      active: rows.find(r => !r.ended_at) ? this.describe(rows.find(r => !r.ended_at)) : null,
      sessions: rows.filter(r => r.ended_at).map(r => this.describe(r)) };
  }

  pause(row, now = Date.now()) {
    if (!row.timer_started_at || row.ended_at) return;
    const seconds = Math.min(MAX_SECONDS - row.duration_seconds, Math.max(0, Math.floor((now - Date.parse(row.timer_started_at)) / 1000)));
    const add = this.db.prepare(`INSERT INTO homework_session_days(session_id, date, seconds) VALUES (?, ?, ?)
      ON CONFLICT(session_id, date) DO UPDATE SET seconds = seconds + excluded.seconds`);
    for (const day of splitSeconds(row.timer_started_at, seconds)) add.run(row.id, day.date, day.seconds);
    this.db.prepare('UPDATE homework_sessions SET duration_seconds = duration_seconds + ?, timer_started_at = NULL WHERE id = ?').run(seconds, row.id);
  }

  pauseChild(childId, now) {
    for (const row of this.db.prepare('SELECT * FROM homework_sessions WHERE child_id = ? AND timer_started_at IS NOT NULL AND ended_at IS NULL').all(childId)) this.pause(row, now);
  }

  start(recordId) {
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      if (task.is_completed || task.skipped_at) throw fail(409, '已完成或已跳过的作业不能开始学习');
      if (task.date > getTodayDate()) throw fail(409, '作业尚未开始');
      const active = this.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(task.id);
      if (active?.timer_started_at) return;
      const now = Date.now();
      this.timers.pauseRunning(task.child_id, now);
      if (active) this.db.prepare('UPDATE homework_sessions SET timer_started_at = ? WHERE id = ?').run(new Date(now).toISOString(), active.id);
      else this.db.prepare(`INSERT INTO homework_sessions(id, task_id, child_id, started_at, timer_started_at) VALUES (?, ?, ?, ?, ?)`)
        .run(generateId(), task.id, task.child_id, new Date(now).toISOString(), new Date(now).toISOString());
    })();
    return this.details(recordId);
  }

  pauseSession(recordId, id) {
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      this.pause(this.session(task.id, id));
    })();
    return this.details(recordId);
  }

  validateNote(note = '') {
    if (typeof note !== 'string' || note.trim().length > 500) throw fail(400, '进展不超过 500 个字');
    return note.trim();
  }
  validateSeconds(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_SECONDS) throw fail(400, '本次用时须在 0 秒到 12 小时之间');
    return seconds;
  }
  validateDay(date, actor) {
    parseDate(date);
    if (date > getTodayDate()) throw fail(400, '不能记录未来的学习');
    if (actor !== 'parent' && date !== getTodayDate()) throw fail(403, '孩子只能更正今天的学习记录');
  }

  complete(recordId, actor) {
    const { task } = this.task(recordId);
    if (task.is_completed) return;
    if (task.skipped_at || task.date > getTodayDate()) throw fail(409, '作业已跳过或尚未开始');
    if (this.db.prepare('SELECT 1 FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(task.id)) throw fail(409, '请先结束本次学习');
    if (actor !== 'parent' && !this.tasks.childMayActOn(task)) {
      this.db.prepare('UPDATE homework_records SET completion_requested_at = COALESCE(completion_requested_at, ?) WHERE id = ?').run(new Date().toISOString(), recordId);
      return;
    }
    this.tasks.completeDailyTask(task.id, { duration_seconds: null, completionSource: actor === 'parent' && !this.tasks.childMayActOn(task) ? 'parent_backfill' : null });
    this.db.prepare('UPDATE homework_records SET completion_requested_at = NULL WHERE id = ?').run(recordId);
  }

  finish(recordId, id, body, actor) {
    if (body.complete !== undefined && typeof body.complete !== 'boolean') throw fail(400, '完成设置无效');
    const note = this.validateNote(body.note);
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      const row = this.session(task.id, id);
      if (row.ended_at) return; // A retried finish never saves time or awards twice.
      this.pause(row);
      this.db.prepare('UPDATE homework_sessions SET ended_at = ?, note = ?, completion_action = ? WHERE id = ?')
        .run(new Date().toISOString(), note, body.complete ? 1 : 0, id);
      if (body.complete) this.complete(recordId, actor);
    })();
    return this.details(recordId);
  }

  manual(recordId, body, actor) {
    const date = body.date || getTodayDate();
    this.validateDay(date, actor);
    const seconds = this.validateSeconds(body.duration_seconds);
    const note = this.validateNote(body.note);
    if (typeof body.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.request_id)) throw fail(400, '缺少有效的记录标识');
    this.db.transaction(() => {
      const { record, task } = this.task(recordId);
      if (date < record.assigned_date) throw fail(400, '学习日期不能早于作业布置日期');
      const existing = this.db.prepare('SELECT * FROM homework_sessions WHERE id = ?').get(body.request_id);
      if (existing) {
        if (existing.task_id !== task.id) throw fail(409, '记录标识已使用');
        return;
      }
      this.db.prepare(`INSERT INTO homework_sessions(id, task_id, child_id, started_at, ended_at, note, duration_seconds, duration_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`).run(body.request_id, task.id, task.child_id, `${date}T00:00:00Z`, new Date().toISOString(), note, seconds);
      this.db.prepare('INSERT INTO homework_session_days(session_id, date, seconds) VALUES (?, ?, ?)').run(body.request_id, date, seconds);
    })();
    return this.details(recordId);
  }

  edit(recordId, id, body, actor) {
    this.db.transaction(() => {
      const { record, task } = this.task(recordId);
      const row = this.session(task.id, id);
      if (!row.ended_at) throw fail(409, '请先结束本次学习');
      const dates = this.db.prepare('SELECT date FROM homework_session_days WHERE session_id = ?').all(id).map(r => r.date);
      if (!dates.length) dates.push(formatDate(new Date(row.started_at)));
      for (const date of dates) this.validateDay(date, actor);
      const note = body.note === undefined ? row.note : this.validateNote(body.note);
      if (body.duration_seconds !== undefined) {
        const seconds = this.validateSeconds(body.duration_seconds);
        // A correction spanning midnight must keep an explicit per-day allocation.
        const allocations = body.days || (dates.length === 1 ? [{ date: dates[0], seconds }] : null);
        if (!Array.isArray(allocations) || !allocations.length) throw fail(400, '跨日记录请分别填写每天用时');
        const seen = new Set(); let total = 0;
        for (const day of allocations) {
          if (!day || typeof day !== 'object') throw fail(400, '每天用时格式无效');
          this.validateDay(day.date, actor);
          if (day.date < record.assigned_date || seen.has(day.date)) throw fail(400, '学习日期无效或重复');
          seen.add(day.date); total += this.validateSeconds(day.seconds);
        }
        if (total !== seconds) throw fail(400, '每天用时合计须与本次用时一致');
        this.db.prepare('DELETE FROM homework_session_days WHERE session_id = ?').run(id);
        const insert = this.db.prepare('INSERT INTO homework_session_days(session_id, date, seconds) VALUES (?, ?, ?)');
        for (const day of allocations) insert.run(id, day.date, day.seconds);
        this.db.prepare("UPDATE homework_sessions SET duration_seconds = ?, duration_source = 'manual' WHERE id = ?").run(seconds, id);
      }
      this.db.prepare('UPDATE homework_sessions SET note = ? WHERE id = ?').run(note, id);
    })();
    return this.details(recordId);
  }

  reject(recordId) {
    this.homework.get(recordId);
    this.db.prepare('UPDATE homework_records SET completion_requested_at = NULL WHERE id = ?').run(recordId);
    return this.details(recordId);
  }
}
module.exports = HomeworkStudyService;
module.exports.splitSeconds = splitSeconds;
