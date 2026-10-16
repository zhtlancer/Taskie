const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { hashPin, verifyPin } = require('../utils/crypto');
const { formatDate } = require('../utils/date');

const defaultBadges = [
  {
    id: 'badge-first-complete',
    key: 'first_complete',
    name: '初出茅庐',
    description: '第一次完成任务',
    icon_emoji: '🌟',
    condition_type: 'first_complete',
    condition_value: 1
  },
  {
    id: 'badge-streak-3',
    key: 'streak_3',
    name: '三连击',
    description: '连续3天完成任务',
    icon_emoji: '🔥',
    condition_type: 'streak_days',
    condition_value: 3
  },
  {
    id: 'badge-streak-7',
    key: 'streak_7',
    name: '一周勇士',
    description: '连续7天完成任务',
    icon_emoji: '🚀',
    condition_type: 'streak_days',
    condition_value: 7
  },
  {
    id: 'badge-streak-30',
    key: 'streak_30',
    name: '月度冠军',
    description: '连续30天完成任务',
    icon_emoji: '👑',
    condition_type: 'streak_days',
    condition_value: 30
  },
  {
    id: 'badge-points-100',
    key: 'points_100',
    name: '小富翁',
    description: '累计积分≥100',
    icon_emoji: '💰',
    condition_type: 'total_points',
    condition_value: 100
  },
  {
    id: 'badge-points-500',
    key: 'points_500',
    name: '积分达人',
    description: '累计积分≥500',
    icon_emoji: '💎',
    condition_type: 'total_points',
    condition_value: 500
  },
  {
    id: 'badge-all-done-once',
    key: 'all_done_once',
    name: '全勤王',
    description: '第一次完成当天所有任务',
    icon_emoji: '✅',
    condition_type: 'all_done_count',
    condition_value: 1
  },
  {
    id: 'badge-all-done-10',
    key: 'all_done_10',
    name: '优秀学生',
    description: '10次完成当天所有任务',
    icon_emoji: '🏆',
    condition_type: 'all_done_count',
    condition_value: 10
  }
];

// Task timing (schema v11): templates and long-term tasks say whether time is recorded and how long
// a session should take; daily tasks snapshot that, keep their timer and the final duration; progress
// entries keep the duration of their session.
const TIMING_COLUMNS = {
  task_templates: { track_time: 'INTEGER NOT NULL DEFAULT 0', expected_minutes: 'INTEGER' },
  daily_tasks: {
    track_time: 'INTEGER NOT NULL DEFAULT 0', expected_minutes: 'INTEGER',
    duration_seconds: 'INTEGER', duration_source: 'TEXT', // source: timer | manual
    timer_started_at: 'TEXT', timer_elapsed_seconds: 'INTEGER NOT NULL DEFAULT 0'
  },
  period_tasks: {
    track_time: 'INTEGER NOT NULL DEFAULT 0', expected_minutes: 'INTEGER',
    timer_started_at: 'TEXT', timer_elapsed_seconds: 'INTEGER NOT NULL DEFAULT 0'
  },
  period_task_logs: { duration_seconds: 'INTEGER', duration_source: 'TEXT' }
};

let globalDb = null;

function initDb(db) {
  console.log('    [SQLite] 正在执行 schema.sql 初始化/校验数据表结构...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  // Versioned, idempotent upgrades preserve existing NAS data.
  if (db.pragma('user_version', { simple: true }) < 1) {
    db.transaction(() => {
      const addColumns = (table, columns) => {
        const existing = new Set(db.pragma(`table_info(${table})`).map(c => c.name));
        for (const [name, definition] of Object.entries(columns)) {
          if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        }
      };
      addColumns('task_templates', { schedule_type: "TEXT NOT NULL DEFAULT 'fixed_days'", weekly_target_times: 'INTEGER' });
      addColumns('daily_tasks', { schedule_type: "TEXT NOT NULL DEFAULT 'fixed_days'", weekly_target_times: 'INTEGER' });
      // Historical duplicate instances must remain intact; service insertion is transactional.
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_tasks_template_date ON daily_tasks(child_id, template_id, date)');
      db.pragma('user_version = 1');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 2) {
    db.transaction(() => {
      // Existing templates keep applying to every child.
      if (!db.pragma('table_info(task_templates)').some(c => c.name === 'assign_all')) {
        db.exec('ALTER TABLE task_templates ADD COLUMN assign_all INTEGER NOT NULL DEFAULT 1');
      }
      db.pragma('user_version = 2');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 3) {
    // reward_items and reward_redemptions are created by schema.sql.
    db.pragma('user_version = 3');
  }
  if (db.pragma('user_version', { simple: true }) < 4) {
    db.transaction(() => {
      const columns = new Set(db.pragma('table_info(daily_tasks)').map(c => c.name));
      if (!columns.has('source_template_id')) db.exec('ALTER TABLE daily_tasks ADD COLUMN source_template_id TEXT');
      if (!columns.has('template_created_at')) db.exec('ALTER TABLE daily_tasks ADD COLUMN template_created_at TEXT');
      db.exec(`UPDATE daily_tasks SET source_template_id = template_id,
        template_created_at = (SELECT created_at FROM task_templates WHERE id = daily_tasks.template_id)
        WHERE source_template_id IS NULL AND template_id IS NOT NULL`);
      db.pragma('user_version = 4');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 5) {
    db.transaction(() => {
      // Periods and their tasks are created by schema.sql. Earned points outlive a deleted
      // period or task; only undoing a progress entry takes its points back.
      if (!db.pragma('table_info(point_logs)').some(c => c.name === 'period_log_id')) {
        db.exec('ALTER TABLE point_logs ADD COLUMN period_log_id TEXT REFERENCES period_task_logs(id) ON DELETE SET NULL');
      }
      db.pragma('user_version = 5');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 6) {
    db.transaction(() => {
      const columns = new Set(db.pragma('table_info(point_logs)').map(c => c.name));
      if (!columns.has('activity_date')) db.exec('ALTER TABLE point_logs ADD COLUMN activity_date TEXT');
      if (!columns.has('activity_title')) db.exec('ALTER TABLE point_logs ADD COLUMN activity_title TEXT');
      db.exec(`UPDATE point_logs SET
        activity_date = COALESCE(activity_date,
          (SELECT date FROM daily_tasks WHERE id = point_logs.daily_task_id),
          (SELECT date FROM period_task_logs WHERE id = point_logs.period_log_id)),
        activity_title = COALESCE(activity_title,
          (SELECT title FROM daily_tasks WHERE id = point_logs.daily_task_id),
          (SELECT CASE WHEN t.mode = 'progress' THEN t.title || ' ' || l.amount || t.unit ELSE t.title END
            FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id WHERE l.id = point_logs.period_log_id))`);
      // Already deleted sources cannot reveal their original title or backfill date.
      // Retain these entries on their known earning date with an explicit label.
      const fill = db.prepare('UPDATE point_logs SET activity_date = COALESCE(activity_date, ?), activity_title = COALESCE(activity_title, ?) WHERE id = ?');
      for (const row of db.prepare('SELECT id, earned_at FROM point_logs WHERE activity_date IS NULL OR activity_title IS NULL').all()) {
        fill.run(formatDate(new Date(row.earned_at)), '历史积分记录（来源已删除）', row.id);
      }
      db.pragma('user_version = 6');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 7) {
    db.transaction(() => {
      // 'template': generated from a task template; 'adhoc': a one-off task a parent added for a day.
      if (!db.pragma('table_info(daily_tasks)').some(c => c.name === 'origin')) {
        db.exec("ALTER TABLE daily_tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'template'");
      }
      db.pragma('user_version = 7');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 8) {
    // Holiday tasks become general long-term tasks: they may stand alone (no period), so the table
    // is rebuilt with a nullable period_id. Foreign keys are off while the old table is replaced
    // so its progress entries are not cascade-deleted.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        if (!db.pragma('table_info(period_tasks)').some(c => c.name === 'child_id')) {
          db.exec(`
          CREATE TABLE period_tasks_v8 (
            id TEXT PRIMARY KEY,
            period_id TEXT,                         -- set for holiday tasks, whose dates follow the period
            child_id TEXT NOT NULL,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'check',     -- check: done once | progress: logged towards total_amount
            input_mode TEXT NOT NULL DEFAULT 'increment', -- progress entries: increment (done today) | position (reached page N)
            total_amount INTEGER NOT NULL DEFAULT 1,
            unit TEXT,
            points INTEGER NOT NULL DEFAULT 0,      -- per unit for progress, on completion for check
            completion_bonus INTEGER NOT NULL DEFAULT 0,
            start_date TEXT NOT NULL,
            end_date TEXT,                          -- NULL: no deadline
            daily_required INTEGER NOT NULL DEFAULT 0, -- 1: logging progress is a required task each day
            completed_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
            FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
          );
          `);
          db.exec(`INSERT INTO period_tasks_v8 (id, period_id, child_id, title, subject, mode, input_mode, total_amount, unit,
              points, completion_bonus, start_date, end_date, daily_required, completed_at, created_at)
            SELECT t.id, t.period_id, p.child_id, t.title, t.subject, t.mode, 'increment', t.total_amount, t.unit,
              t.points, 0, p.start_date, p.end_date, 0,
              CASE WHEN (SELECT COALESCE(SUM(amount), 0) FROM period_task_logs WHERE period_task_id = t.id) >= t.total_amount
                THEN (SELECT MAX(created_at) FROM period_task_logs WHERE period_task_id = t.id) END,
              t.created_at
            FROM period_tasks t JOIN periods p ON p.id = t.period_id`);
          db.exec('DROP TABLE period_tasks');
          db.exec('ALTER TABLE period_tasks_v8 RENAME TO period_tasks');
          db.exec('CREATE INDEX IF NOT EXISTS idx_period_tasks_period ON period_tasks(period_id)');
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_period_tasks_child ON period_tasks(child_id)');
        if (!db.pragma('table_info(period_task_logs)').some(c => c.name === 'position')) {
          db.exec('ALTER TABLE period_task_logs ADD COLUMN position INTEGER');
        }
        // A long-term task with daily_required gets a daily_tasks row each day, linked here.
        if (!db.pragma('table_info(daily_tasks)').some(c => c.name === 'goal_id')) {
          db.exec('ALTER TABLE daily_tasks ADD COLUMN goal_id TEXT');
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_daily_tasks_goal ON daily_tasks(goal_id, date)');
        if (db.pragma('foreign_key_check').length) throw new Error('长期任务迁移后外键检查失败');
        db.pragma('user_version = 8');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  if (db.pragma('user_version', { simple: true }) < 9) {
    db.transaction(() => {
      // The character book also holds words, and entries carry categories such as 会写 or 笔画要改正.
      if (!db.pragma('table_info(characters)').some(c => c.name === 'categories')) {
        db.exec("ALTER TABLE characters ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
      }
      db.pragma('user_version = 9');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 10) {
    db.transaction(() => {
      // A task a parent let the child skip that day; task_skip_requests (from schema.sql) keeps the requests.
      const columns = new Set(db.pragma('table_info(daily_tasks)').map(c => c.name));
      if (!columns.has('skipped_at')) db.exec('ALTER TABLE daily_tasks ADD COLUMN skipped_at TEXT');
      if (!columns.has('skip_reason')) db.exec('ALTER TABLE daily_tasks ADD COLUMN skip_reason TEXT');
      db.pragma('user_version = 10');
    })();
  }
  if (db.pragma('user_version', { simple: true }) < 11) {
    db.transaction(() => {
      for (const [table, columns] of Object.entries(TIMING_COLUMNS)) {
        const existing = new Set(db.pragma(`table_info(${table})`).map(c => c.name));
        for (const [name, definition] of Object.entries(columns)) {
          if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        }
      }
      db.pragma('user_version = 11');
    })();
  }
  console.log('    [SQLite] 数据表结构校验完成，检查默认成就徽章...');

  // Seed default badge definitions if not existing
  const insertBadgeStmt = db.prepare(`
    INSERT OR IGNORE INTO badge_definitions (id, key, name, description, icon_emoji, condition_type, condition_value)
    VALUES (@id, @key, @name, @description, @icon_emoji, @condition_type, @condition_value)
  `);

  const insertMany = db.transaction((badges) => {
    for (const b of badges) {
      insertBadgeStmt.run(b);
    }
  });
  insertMany(defaultBadges);
  console.log('    [SQLite] 默认成就徽章检查就绪，检查管理员 PIN...');

  // Seed default parent PIN in settings if not existing
  const getParentPinStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const existingParentPin = getParentPinStmt.get('parent_pin_hash');
  if (!existingParentPin) {
    const defaultPinHash = hashPin(config.defaultParentPin);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('parent_pin_hash', defaultPinHash);
    console.log('    [SQLite] 已初始化家长 PIN 码');
  }
  // The documented default PIN must be changed before the parent console can be used. Databases
  // (and backups) from before this flag existed get it from comparing their PIN with the default.
  if (!getParentPinStmt.get('parent_pin_is_default')) {
    const isDefault = verifyPin(config.defaultParentPin, getParentPinStmt.get('parent_pin_hash').value);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('parent_pin_is_default', isDefault ? '1' : '0');
  }
  console.log('    [SQLite] 数据库基础数据初始化完毕');
}

function configureAndInitDb(dbPath) {
  if (dbPath !== ':memory:') {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  console.log('    [SQLite] 正在打开数据库连接:', dbPath);
  const db = new Database(dbPath);

  // Use DELETE mode directly for Synology NAS/Docker volume stability (WAL requires POSIX shm which fails on NAS mounts)
  const journalMode = (process.env.SQLITE_JOURNAL_MODE || 'DELETE').toUpperCase();
  try {
    db.pragma(`journal_mode = ${journalMode}`);
    console.log(`    [SQLite] journal_mode 设置为: ${journalMode}`);
  } catch (jErr) {
    console.warn(`    ⚠️ [SQLite] 设置 journal_mode=${journalMode} 失败，降级为 DELETE:`, jErr.message);
    try { db.pragma('journal_mode = DELETE'); } catch (_) {}
  }

  try {
    db.pragma('busy_timeout = 10000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
  } catch (pErr) {
    console.warn('    ⚠️ [SQLite] 设置 pragma 参数警告:', pErr.message);
  }

  initDb(db);
  return db;
}

function getDb(customPath) {
  if (customPath) {
    return configureAndInitDb(customPath);
  }

  if (!globalDb) {
    globalDb = configureAndInitDb(config.dbPath);
  }

  return globalDb;
}

module.exports = {
  getDb,
  initDb,
  defaultBadges,
  TIMING_COLUMNS
};
