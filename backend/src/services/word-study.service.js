const { generateId } = require('../utils/crypto');
const { getTodayDate, formatDate, parseDate, shiftDate, getDayOfWeek } = require('../utils/date');
const { CATEGORIES } = require('./characters.service');
const { cancelPendingSkips } = require('../utils/skips');

// Adjustable product defaults, not a claim of a universal optimal memory curve.
const INTERVALS = [1, 3, 7, 14, 30];
const fail = (status, message) => ({ status, message });
const parseList = value => JSON.parse(value);
const title = skill => `字词${skill === 'write' ? '书写' : '认读'}学习`;

class WordStudyService {
  constructor(db, rewardsService) { this.db = db; this.rewardsService = rewardsService; }

  plans(childId) {
    if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw fail(404, '孩子不存在');
    return this.db.prepare('SELECT * FROM word_study_plans WHERE child_id = ? ORDER BY skill').all(childId)
      .map(row => ({ ...row, enabled: Boolean(row.enabled), required: Boolean(row.required), include_mastered: Boolean(row.include_mastered),
        days_of_week: parseList(row.days_of_week), categories: parseList(row.categories), intervals: INTERVALS }));
  }

  savePlan(childId, skill, data) {
    if (!['recognize', 'write'].includes(skill)) throw fail(400, '学习方式无效');
    const previous = this.plans(childId).find(plan => plan.skill === skill);
    const plan = { enabled: true, required: true, include_mastered: false, new_target: 3, review_target: 10,
      points: 10, extra_points: 0, extra_reward_limit: 0, days_of_week: [1, 2, 3, 4, 5], categories: [], start_date: getTodayDate(), ...previous, ...data };
    for (const key of ['enabled', 'required', 'include_mastered']) if (typeof plan[key] !== 'boolean') throw fail(400, '学习计划开关无效');
    for (const [key, max] of [['new_target', 30], ['review_target', 100], ['points', 10000], ['extra_points', 10000], ['extra_reward_limit', 20]]) {
      if (!Number.isSafeInteger(plan[key]) || plan[key] < 0 || plan[key] > max) throw fail(400, '学习数量或奖励超出范围');
    }
    if (!plan.new_target && !plan.review_target) throw fail(400, '新学和复习目标不能同时为零');
    if (!Array.isArray(plan.days_of_week) || !plan.days_of_week.length || plan.days_of_week.some(d => !Number.isInteger(d) || d < 0 || d > 6) ||
      !Array.isArray(plan.categories) || plan.categories.some(c => !CATEGORIES.includes(c))) throw fail(400, '学习日或分类无效');
    parseDate(plan.start_date);
    if (!previous && (plan.start_date < getTodayDate() || plan.start_date > shiftDate(getTodayDate(), 366))) throw fail(400, '开始日期须为今天起一年以内');
    if (previous && plan.start_date !== previous.start_date) throw fail(409, '已建立的计划不能修改开始日期');
    this.db.transaction(() => {
      // Today's existing list and awards are snapshots; edits take effect on the next list.
      if (previous) this.ensureScheduled(childId);
      this.db.prepare(`INSERT INTO word_study_plans
        (id, child_id, skill, enabled, start_date, days_of_week, categories, include_mastered, new_target, review_target, required, points, extra_points, extra_reward_limit, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(child_id, skill) DO UPDATE SET enabled = excluded.enabled, days_of_week = excluded.days_of_week,
          categories = excluded.categories, include_mastered = excluded.include_mastered, new_target = excluded.new_target,
          review_target = excluded.review_target, required = excluded.required, points = excluded.points,
          extra_points = excluded.extra_points, extra_reward_limit = excluded.extra_reward_limit`)
        .run(previous?.id || generateId(), childId, skill, +plan.enabled, plan.start_date, JSON.stringify([...new Set(plan.days_of_week)]),
          JSON.stringify([...new Set(plan.categories)]), +plan.include_mastered, plan.new_target, plan.review_target, +plan.required,
          plan.points, plan.extra_points, plan.extra_reward_limit, new Date().toISOString());
      this.ensureScheduled(childId);
    })();
    return this.plans(childId).find(plan => plan.skill === skill);
  }

  pool(plan, date, cutoff = null) {
    const selectedCategories = typeof plan.categories === 'string' ? parseList(plan.categories) : plan.categories;
    const rows = this.db.prepare(`SELECT c.*, s.id AS state_id, s.stage, s.next_due_date, s.last_review_date, COALESCE(s.failures, 0) AS failures
      FROM characters c LEFT JOIN word_study_states s ON s.character_id = c.id AND s.skill = ?
      WHERE c.child_id = ? ORDER BY c.created_at, c.id`).all(plan.skill, plan.child_id);
    const eligible = rows.filter(row => formatDate(new Date(row.created_at)) <= date && (!cutoff || row.created_at <= cutoff) &&
      (row.state_id || plan.include_mastered || !row.is_mastered) &&
      (!selectedCategories.length || selectedCategories.some(category => parseList(row.categories).includes(category))));
    const priority = row => row.failures * 4 + (parseList(row.categories).includes('error_prone') ? 2 : 0) +
      (plan.skill === 'write' && parseList(row.categories).includes('fix_strokes') ? 1 : 0);
    return {
      review: eligible.filter(row => row.state_id && row.next_due_date <= date && row.last_review_date !== date)
        .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date) || priority(b) - priority(a)),
      fresh: eligible.filter(row => !row.state_id).sort((a, b) => priority(b) - priority(a)),
      early: eligible.filter(row => row.state_id && row.next_due_date > date && row.last_review_date !== date)
        .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
    };
  }

  insertBatch(day, candidates, isExtra, id = generateId()) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO word_study_batches (id, day_id, is_extra, created_at) VALUES (?, ?, ?, ?)').run(id, day.id, +isExtra, now);
    const insert = this.db.prepare('INSERT INTO word_study_items (id, batch_id, character_id, text, pinyin, kind, position, is_early) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    if (!candidates.length) this.db.prepare('UPDATE word_study_batches SET completed_at = ? WHERE id = ?').run(now, id);
    candidates.forEach((row, position) => insert.run(generateId(), id, row.id, row.char, row.pinyin, row.state_id ? 'review' : 'new', position, +(Boolean(row.state_id) && row.next_due_date > day.date)));
  }

  ensureScheduled(childId) {
    const today = getTodayDate();
    const hasDay = this.db.prepare('SELECT 1 FROM word_study_days WHERE plan_id = ? AND date = ?');
    // Most reads find every plan already scheduled through today; they must not write. A study day
    // without a list (nothing to learn yet) is checked again, in case words were added since.
    const settled = plan => plan.last_scheduled_date === today && (!plan.enabled || today < plan.start_date ||
      !parseList(plan.days_of_week).includes(getDayOfWeek(today)) || Boolean(hasDay.get(plan.id, today)));
    const plans = this.db.prepare('SELECT * FROM word_study_plans WHERE child_id = ?').all(childId).filter(plan => !settled(plan));
    if (!plans.length) return;
    this.db.transaction(() => {
      for (const plan of plans) {
        // Catch up missed scheduled days without inventing answers or moving memory stages.
        let from = plan.last_scheduled_date ? shiftDate(plan.last_scheduled_date, 1) : plan.start_date;
        if (from > today) from = today;
        for (let date = from; date <= today; date = shiftDate(date, 1)) {
          if (!plan.enabled || date < plan.start_date || !parseList(plan.days_of_week).includes(getDayOfWeek(date)) ||
            this.db.prepare('SELECT id FROM word_study_days WHERE plan_id = ? AND date = ?').get(plan.id, date)) continue;
          const pool = this.pool(plan, date);
          const candidates = [...pool.review.slice(0, plan.review_target), ...pool.fresh.slice(0, plan.new_target)];
          if (!candidates.length && !pool.review.length && !pool.fresh.length && !pool.early.length) continue;
          const day = { ...plan, id: generateId(), date };
          this.db.prepare(`INSERT INTO word_study_days (id, plan_id, child_id, date, skill, categories, include_mastered, required, points, extra_points, extra_reward_limit, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(day.id, plan.id, childId, date, plan.skill, plan.categories, plan.include_mastered, candidates.length ? plan.required : 0, candidates.length ? plan.points : 0, plan.extra_points, plan.extra_reward_limit, new Date().toISOString());
          this.insertBatch(day, candidates, false);
          if (candidates.length) this.db.prepare(`INSERT INTO daily_tasks (id, child_id, title, subject, points, date, origin, study_day_id)
            VALUES (?, ?, ?, '语文', ?, ?, 'study', ?)`).run(generateId(), childId, title(plan.skill), plan.points, date, day.id);
        }
        if (plan.last_scheduled_date !== today) this.db.prepare('UPDATE word_study_plans SET last_scheduled_date = ? WHERE id = ?').run(today, plan.id);
      }
    })();
  }

  getDay(id) {
    const day = this.db.prepare('SELECT * FROM word_study_days WHERE id = ?').get(id);
    if (!day) throw fail(404, '学习清单不存在');
    return day;
  }

  describeDay(id) {
    const day = this.getDay(id);
    const batches = this.db.prepare('SELECT * FROM word_study_batches WHERE day_id = ? ORDER BY is_extra, created_at, rowid').all(id)
      .map(batch => ({ ...batch, is_extra: Boolean(batch.is_extra), items: this.db.prepare('SELECT i.*, s.next_due_date, s.stage FROM word_study_items i LEFT JOIN word_study_states s ON s.character_id = i.character_id AND s.skill = ? WHERE i.batch_id = ? ORDER BY i.position').all(day.skill, batch.id) }));
    const pool = this.pool(day, day.date, day.created_at);
    const used = new Set(batches.flatMap(batch => batch.items.map(item => item.character_id)));
    const remainingDue = pool.review.filter(row => !used.has(row.id)).length;
    const remainingNew = pool.fresh.filter(row => !used.has(row.id)).length;
    const remainingEarly = pool.early.filter(row => !used.has(row.id)).length;
    const base = batches.find(batch => !batch.is_extra);
    return { ...day, required: Boolean(day.required), title: title(day.skill), batches, base_done: Boolean(base?.completed_at),
      base_total: base?.items.length || 0, base_completed: base?.items.filter(item => item.result).length || 0,
      remaining_due: remainingDue, remaining_new: remainingNew, remaining_early: remainingEarly, extra_rewarded: batches.filter(batch => batch.is_extra && batch.points > 0).length };
  }

  today(childId) {
    this.plans(childId);
    this.ensureScheduled(childId);
    return { date: getTodayDate(), intervals: INTERVALS, plans: this.plans(childId),
      days: this.db.prepare('SELECT id FROM word_study_days WHERE child_id = ? AND date = ? ORDER BY skill').all(childId, getTodayDate()).map(day => this.describeDay(day.id)) };
  }

  extra(id, requestId) {
    const day = this.getDay(id);
    if (day.date !== getTodayDate()) throw fail(403, '只能追加今天的学习');
    if (typeof requestId !== 'string' || !/^[\w-]{8,80}$/.test(requestId)) throw fail(400, '请求标识无效');
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT day_id FROM word_study_batches WHERE id = ?').get(requestId);
      if (existing) { if (existing.day_id !== id) throw fail(409, '请求标识已被使用'); return; }
      const described = this.describeDay(id);
      if (!described.base_done) throw fail(409, '先完成今天的基础目标');
      if (described.batches.some(batch => !batch.completed_at)) return;
      const pool = this.pool(day, day.date, day.created_at);
      const used = new Set(described.batches.flatMap(batch => batch.items.map(item => item.character_id)));
      const candidates = [...pool.review, ...pool.fresh, ...pool.early].filter(row => !used.has(row.id)).slice(0, 3);
      if (candidates.length) this.insertBatch(day, candidates, true, requestId);
    })();
    return this.describeDay(id);
  }

  grade(itemId, { result, request_id: requestId }, role) {
    if (!['good', 'hinted', 'again'].includes(result)) throw fail(400, '练习结果无效');
    if (typeof requestId !== 'string' || !/^[\w-]{8,80}$/.test(requestId)) throw fail(400, '请求标识无效');
    const item = this.db.prepare(`SELECT i.*, b.day_id, b.is_extra FROM word_study_items i JOIN word_study_batches b ON b.id = i.batch_id WHERE i.id = ?`).get(itemId);
    if (!item) throw fail(404, '学习内容不存在');
    const day = this.getDay(item.day_id);
    const today = getTodayDate();
    if (day.date !== today) throw fail(403, '只能记录今天实际进行的练习');
    let pointsEarned = 0;
    this.db.transaction(() => {
      const oldAttempt = this.db.prepare('SELECT item_id, result FROM word_study_attempts WHERE id = ?').get(requestId);
      if (oldAttempt) { if (oldAttempt.item_id !== itemId || oldAttempt.result !== result) throw fail(409, '请求标识已被使用'); return; }
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO word_study_attempts (id, item_id, result, actor, created_at) VALUES (?, ?, ?, ?, ?)').run(requestId, itemId, result, role, now);
      if (item.result) {
        // A retry can reveal a weakness and shorten the interval; it cannot promote memory or pay twice.
        this.db.prepare('UPDATE word_study_items SET result = ? WHERE id = ?').run(result, itemId);
        if (item.character_id && result !== 'good') this.db.prepare(`UPDATE word_study_states SET
          stage = CASE WHEN ? = 'again' THEN 0 ELSE stage END, next_due_date = ?, failures = failures + CASE WHEN ? = 'again' THEN 1 ELSE 0 END
          WHERE character_id = ? AND skill = ?`).run(result, shiftDate(today, 1), result, item.character_id, day.skill);
        return;
      }
      this.db.prepare('UPDATE word_study_items SET result = ?, completed_at = ? WHERE id = ?').run(result, now, itemId);
      if (item.character_id) {
        const state = this.db.prepare('SELECT * FROM word_study_states WHERE character_id = ? AND skill = ?').get(item.character_id, day.skill);
        if (item.is_early && result === 'good' && state) {
          this.db.prepare('UPDATE word_study_states SET last_review_date = ? WHERE id = ?').run(today, state.id);
        } else if (state?.last_review_date !== today) {
          const stage = result === 'good' ? (state ? Math.min(state.stage + 1, INTERVALS.length - 1) : 0) : result === 'again' ? 0 : state?.stage || 0;
          const due = shiftDate(today, result === 'good' ? INTERVALS[stage] : 1);
          this.db.prepare(`INSERT INTO word_study_states (id, child_id, character_id, skill, stage, next_due_date, last_review_date, failures)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(character_id, skill) DO UPDATE SET stage = excluded.stage,
            next_due_date = excluded.next_due_date, last_review_date = excluded.last_review_date, failures = excluded.failures`)
            .run(state?.id || generateId(), day.child_id, item.character_id, day.skill, stage, due, today, (state?.failures || 0) + (result === 'again' ? 1 : 0));
        }
      }
      const unfinished = this.db.prepare('SELECT 1 FROM word_study_items WHERE batch_id = ? AND result IS NULL').get(item.batch_id);
      if (unfinished) return;
      if (item.is_extra) {
        const paid = this.db.prepare('SELECT COUNT(*) AS n FROM word_study_batches WHERE day_id = ? AND is_extra = 1 AND points > 0').get(day.id).n;
        pointsEarned = paid < day.extra_reward_limit ? day.extra_points : 0;
      } else pointsEarned = day.points;
      this.db.prepare('UPDATE word_study_batches SET completed_at = ?, points = ? WHERE id = ?').run(now, pointsEarned, item.batch_id);
      const task = this.db.prepare('SELECT id FROM daily_tasks WHERE study_day_id = ?').get(day.id);
      if (!item.is_extra && task) {
        this.db.prepare('UPDATE daily_tasks SET is_completed = 1, completed_at = ?, earned_points = ? WHERE id = ?').run(now, pointsEarned, task.id);
        cancelPendingSkips(this.db, task.id, now);
        this.db.prepare('UPDATE daily_tasks SET skipped_at = NULL, skip_reason = NULL WHERE id = ?').run(task.id);
      }
      this.db.prepare(`INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at, activity_date, activity_title, study_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), day.child_id, item.is_extra ? null : task?.id || null, pointsEarned, now, day.date, title(day.skill) + (item.is_extra ? ' · 额外学习' : ''), item.batch_id);
      this.rewardsService?.checkAndUnlockBadges(day.child_id);
    })();
    return { day: this.describeDay(day.id), points_earned: pointsEarned };
  }

  history(childId) {
    this.plans(childId);
    this.ensureScheduled(childId);
    return this.db.prepare(`SELECT d.id, d.date, d.skill, d.required,
      COUNT(DISTINCT CASE WHEN b.is_extra = 0 THEN i.id END) AS base_total,
      COUNT(DISTINCT CASE WHEN b.is_extra = 0 AND i.result IS NOT NULL THEN i.id END) AS base_completed,
      COUNT(DISTINCT CASE WHEN b.is_extra = 1 AND i.result IS NOT NULL THEN i.id END) AS extra_completed,
      COUNT(DISTINCT CASE WHEN i.result = 'again' THEN i.id END) AS needs_practice
      FROM word_study_days d JOIN word_study_batches b ON b.day_id = d.id JOIN word_study_items i ON i.batch_id = b.id
      WHERE d.child_id = ? GROUP BY d.id ORDER BY d.date DESC LIMIT 60`).all(childId);
  }
}

module.exports = WordStudyService;
