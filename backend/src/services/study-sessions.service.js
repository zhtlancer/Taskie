const { generateId } = require('../utils/crypto');
const { getTodayDate, formatDate, parseDate } = require('../utils/date');
const { timeZone } = require('../config');
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

// Physical table and legacy column names are retained for v21 backup compatibility.
// All rows are task-scoped and shared by course homework and ordinary timed tasks.
class StudySessionsService {
  constructor(db, tasks, timers) { Object.assign(this, { db, tasks, timers }); }

  checkActor() {}
  checkStart() {}

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
    const corrections = this.db.prepare('SELECT old_seconds, new_seconds, reason, actor, created_at FROM study_legacy_corrections WHERE task_id = ? ORDER BY rowid DESC').all(task.id);
    return { record, time_zone: timeZone, legacy_seconds: task.homework_legacy_seconds || 0,
      legacy_available: task.homework_legacy_seconds > 0 || corrections.length > 0,
      legacy_corrections: corrections,
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

  endActive(taskId) {
    const row = this.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(taskId);
    if (!row) return;
    this.pause(row);
    this.db.prepare('UPDATE homework_sessions SET ended_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  }

  // A paused session that never counted a second is not study: drop it rather than keep a 0-second record.
  discardEmptyActive(taskId) {
    const row = this.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ? AND ended_at IS NULL').get(taskId);
    if (!row || row.timer_started_at || row.duration_seconds > 0) return;
    this.db.prepare('DELETE FROM homework_session_days WHERE session_id = ?').run(row.id);
    this.db.prepare('DELETE FROM homework_sessions WHERE id = ?').run(row.id);
  }

  start(recordId) {
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      this.checkStart(task);
      if (task.is_completed || task.skipped_at) throw fail(409, '已完成或已跳过的作业不能开始学习');
      if (task.date > getTodayDate()) throw fail(409, '作业尚未开始');
      this.timers.remember(task.child_id, 'task', task.id);
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

  correctLegacy(recordId, body, actor) {
    if (actor !== 'parent') throw fail(403, '需要家长权限');
    const seconds = this.validateSeconds(body.duration_seconds);
    const expected = this.validateSeconds(body.expected_old_seconds);
    const reason = this.validateNote(body.reason);
    if (!reason) throw fail(400, '请填写更正原因');
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      if (task.homework_legacy_seconds === null || (task.homework_legacy_seconds === 0 &&
        !this.db.prepare('SELECT 1 FROM study_legacy_corrections WHERE task_id = ?').get(task.id))) throw fail(409, '没有可更正的旧累计用时，请使用手动补记学习');
      if (task.homework_legacy_seconds !== expected) throw fail(409, '旧累计用时已变化，请核对最新数值后重试');
      if (seconds === expected) return;
      this.db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = ? WHERE id = ?').run(seconds, task.id);
      this.db.prepare(`INSERT INTO study_legacy_corrections(id, task_id, child_id, old_seconds, new_seconds, reason, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'parent', ?)`).run(generateId(), task.id, task.child_id, expected, seconds, reason, new Date().toISOString());
    })();
    return this.details(recordId);
  }

  finish(recordId, id, body, actor) {
    if (body.complete !== undefined && typeof body.complete !== 'boolean') throw fail(400, '完成设置无效');
    const note = this.validateNote(body.note);
    let saved = false;
    this.db.transaction(() => {
      const { task } = this.task(recordId);
      this.checkActor(task, actor, 'finish');
      const row = this.session(task.id, id);
      if (row.ended_at) return; // A retried finish never saves time or awards twice.
      this.pause(row);
      this.db.prepare('UPDATE homework_sessions SET ended_at = ?, note = ?, completion_action = ? WHERE id = ?')
        .run(new Date().toISOString(), note, body.complete ? 1 : 0, id);
      saved = true;
    })();
    // Ending a valid session must survive a later denial of completion (for example midnight).
    // A retry of an already-ended session never completes the task again after an undo.
    let completion;
    if (body.complete && saved) {
      try { this.db.transaction(() => this.complete(recordId, actor))(); }
      catch (err) {
        if (![403, 409].includes(err.status)) throw err;
        completion = { status: 'rejected', status_code: err.status, message: err.message };
      }
    }
    const details = this.details(recordId);
    if (body.complete) details.completion_result = completion || {
      status: details.record.task.is_completed ? 'completed' : details.record.completion_requested_at ? 'requested' : 'not_completed',
      message: details.record.task.is_completed ? '任务已完成' : details.record.completion_requested_at ? '已申请全部完成，等待家长确认' : '学习已保存，如需完成任务请单独操作'
    };
    return details;
  }

  completeWithDuration(recordId, body, actor) {
    this.db.transaction(() => {
      const { record, task } = this.task(recordId);
      const requestId = body.request_id;
      if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))) throw fail(400, '记录标识无效');
      if (body.duration_seconds !== undefined && body.duration_seconds !== null && (!Number.isSafeInteger(body.duration_seconds) || body.duration_seconds <= 0)) throw fail(400, '累计用时须为大于 0 的整数秒');
      if (body.expected_total_seconds !== undefined && (!Number.isSafeInteger(body.expected_total_seconds) || body.expected_total_seconds < 0)) throw fail(400, '原累计用时格式无效');
      const note = this.validateNote(body.note);
      const fingerprint = JSON.stringify([body.duration_seconds ?? null, body.expected_total_seconds ?? null, note]);
      const receipt = requestId && this.db.prepare('SELECT * FROM study_completion_requests WHERE id = ?').get(requestId);
      if (receipt) {
        if (receipt.task_id !== task.id || receipt.request_fingerprint !== fingerprint) throw fail(409, '记录标识已使用，请核对原操作');
        return; // Read-only replay, even if completion was undone or the course request rejected.
      }
      const remember = () => {
        if (requestId) this.db.prepare('INSERT INTO study_completion_requests(id, task_id, request_fingerprint, created_at) VALUES (?, ?, ?, ?)')
          .run(requestId, task.id, fingerprint, new Date().toISOString());
      };
      // Omitted duration preserves the existing complete-without-time behavior.
      if (body.duration_seconds === undefined || body.duration_seconds === null) {
        if (body.expected_total_seconds !== undefined) {
          const details = this.details(recordId);
          if (details.total_seconds !== body.expected_total_seconds) throw fail(409, '累计用时已变化，请刷新后重试');
          if (details.active && (details.active.timer_started_at || details.active.duration_seconds > 0)) throw fail(409, '请先结束本次学习，再完成任务');
        }
        this.discardEmptyActive(task.id);
        this.complete(recordId, actor); remember(); return;
      }
      const seconds = body.duration_seconds;
      if (!requestId) throw fail(400, '缺少有效的记录标识');
      this.checkActor(task, actor, 'manual');
      const details = this.details(recordId);
      const expected = body.expected_total_seconds === undefined ? 0 : body.expected_total_seconds;
      const delta = seconds - expected;
      const existing = this.db.prepare('SELECT * FROM homework_sessions WHERE id = ?').get(body.request_id);
      if (existing) {
        if (existing.task_id !== task.id || existing.duration_seconds !== delta || existing.note !== note || existing.completion_action !== 1) throw fail(409, '记录标识已使用，请核对原操作');
        remember(); // Compatibility with additions saved before independent receipts existed.
        return; // A lost response, including after undo, must not add time or complete again.
      }
      if (delta < 0) throw fail(409, '累计用时不能低于已有记录');
      if (delta > MAX_SECONDS) throw fail(400, '单次补充用时不能超过 12 小时');
      if (expected !== details.total_seconds) throw fail(409, '累计用时已变化，请刷新后重试');
      if (delta === 0 && task.is_completed) { remember(); return; }
      if (!task.track_time || task.is_completed) throw fail(409, '任务状态已变化，请核对最新记录后重试');
      if (details.active) {
        if (details.active.timer_started_at || details.active.duration_seconds > 0) throw fail(409, '请先结束本次学习，再调整累计用时');
        this.discardEmptyActive(task.id);
      }
      // A parent completing late records the time on the last day it was due, where the backfilled
      // completion belongs; any other completion records today's time.
      const today = getTodayDate(), due = record.task.due_date;
      const date = actor === 'parent' && !this.tasks.childMayActOn(task) && due < today ? due : today;
      if (delta > 0) {
        this.manual(recordId, { request_id: body.request_id, date, duration_seconds: delta, note }, actor);
        this.db.prepare('UPDATE homework_sessions SET completion_action = 1 WHERE id = ?').run(body.request_id);
      }
      this.complete(recordId, actor);
      remember(); // Receipt, optional added time and completion commit or roll back together.
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
      this.checkActor(task, actor, 'manual');
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
      this.checkActor(task, actor, 'edit');
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


}
module.exports = StudySessionsService;
module.exports.splitSeconds = splitSeconds;
