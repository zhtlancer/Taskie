-- Children accounts
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL DEFAULT '🐱',
  pin_hash TEXT,
  created_at TEXT NOT NULL
);

-- Task templates configured by parents
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  days_of_week TEXT NOT NULL, -- JSON array string, e.g. '[1,2,3,4,5]'
  points INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
);

-- Children a template is limited to (used only when task_templates.assign_all = 0)
CREATE TABLE IF NOT EXISTS template_children (
  template_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  PRIMARY KEY (template_id, child_id),
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_children_child ON template_children(child_id);

-- Daily task instances generated from templates
CREATE TABLE IF NOT EXISTS daily_tasks (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  template_id TEXT,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  date TEXT NOT NULL, -- YYYY-MM-DD
  is_completed INTEGER NOT NULL DEFAULT 0, -- 0: false, 1: true
  completed_at TEXT,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_tasks_child_date ON daily_tasks(child_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_date ON daily_tasks(date);

-- Points earning logs
CREATE TABLE IF NOT EXISTS point_logs (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  daily_task_id TEXT,
  points INTEGER NOT NULL,
  earned_at TEXT NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (daily_task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_point_logs_child ON point_logs(child_id);

-- Badge definitions
CREATE TABLE IF NOT EXISTS badge_definitions (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_emoji TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  condition_value INTEGER NOT NULL
);

-- Badges unlocked by children
CREATE TABLE IF NOT EXISTS child_badges (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  UNIQUE(child_id, badge_id),
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES badge_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_child_badges_child ON child_badges(child_id);

-- Mistake records
CREATE TABLE IF NOT EXISTS mistake_records (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  photo_path TEXT,
  is_mastered INTEGER NOT NULL DEFAULT 0, -- 0: false, 1: true
  created_at TEXT NOT NULL,
  mastered_at TEXT,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mistakes_child_subject ON mistake_records(child_id, subject);

-- Settings (e.g. parent PIN)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Character book (生字本)
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  char TEXT NOT NULL,
  pinyin TEXT,
  strokes INTEGER,
  radical TEXT,
  is_mastered INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  mastered_at TEXT,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  UNIQUE(child_id, char)
);

CREATE INDEX IF NOT EXISTS idx_characters_child ON characters(child_id);
CREATE INDEX IF NOT EXISTS idx_characters_child_mastered ON characters(child_id, is_mastered);
CREATE INDEX IF NOT EXISTS idx_characters_child_created ON characters(child_id, created_at);

-- Rewards parents offer in exchange for points
CREATE TABLE IF NOT EXISTS reward_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  icon_emoji TEXT NOT NULL DEFAULT '🎁',
  cost INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Redemption requests; title, icon and cost are snapshots so history survives reward edits
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  reward_id TEXT,
  title TEXT NOT NULL,
  icon_emoji TEXT NOT NULL,
  cost INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES reward_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_child ON reward_redemptions(child_id, status);

-- Holiday and vacation periods, set per child
CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL, -- YYYY-MM-DD, inclusive
  end_date TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
  created_at TEXT NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_periods_child ON periods(child_id, start_date);

-- Daily and weekly templates paused during a period; unlisted templates keep running
CREATE TABLE IF NOT EXISTS period_paused_templates (
  period_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  PRIMARY KEY (period_id, template_id),
  FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE
);

-- Tasks to finish over a whole period, such as holiday homework
CREATE TABLE IF NOT EXISTS period_tasks (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'check', -- check: done once | progress: logged towards total_amount
  total_amount INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  points INTEGER NOT NULL DEFAULT 0,   -- per unit for progress, on completion for check
  created_at TEXT NOT NULL,
  FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_period_tasks_period ON period_tasks(period_id);

-- Progress entries; the points they earn are point_logs rows linked by period_log_id
CREATE TABLE IF NOT EXISTS period_task_logs (
  id TEXT PRIMARY KEY,
  period_task_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (period_task_id) REFERENCES period_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_period_task_logs_task ON period_task_logs(period_task_id, date);
