const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { hashPin } = require('../utils/crypto');

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

let globalDb = null;

function initDb(db) {
  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

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

  // Seed default parent PIN in settings if not existing
  const getParentPinStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const existingParentPin = getParentPinStmt.get('parent_pin_hash');
  if (!existingParentPin) {
    const defaultPinHash = hashPin(config.defaultParentPin);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('parent_pin_hash', defaultPinHash);
  }
}

function getDb(customPath) {
  if (customPath) {
    const db = new Database(customPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
    return db;
  }

  if (!globalDb) {
    // Ensure parent directory exists
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    globalDb = new Database(config.dbPath);
    globalDb.pragma('journal_mode = WAL');
    globalDb.pragma('foreign_keys = ON');
    initDb(globalDb);
  }

  return globalDb;
}

module.exports = {
  getDb,
  initDb,
  defaultBadges
};
