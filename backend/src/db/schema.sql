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

-- Character and word book (生字生词本): single characters and words of up to 8 characters
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
  categories TEXT NOT NULL DEFAULT '[]', -- JSON array of category keys, see characters.service.js
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

-- Long-term tasks for one child (e.g. reading a book), either standalone or holiday tasks.
-- Keep in sync with the v8 migration in db/index.js.
CREATE TABLE IF NOT EXISTS period_tasks (
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

CREATE INDEX IF NOT EXISTS idx_period_tasks_period ON period_tasks(period_id);

-- Progress entries; the points they earn are point_logs rows linked by period_log_id
CREATE TABLE IF NOT EXISTS period_task_logs (
  id TEXT PRIMARY KEY,
  period_task_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  position INTEGER,                       -- page reached, for position entries
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (period_task_id) REFERENCES period_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_period_task_logs_task ON period_task_logs(period_task_id, date);

-- Requests to skip a task on its day (e.g. the teacher set no homework). A child's request waits for
-- a parent; a parent's own skip is approved at once. Approval marks daily_tasks.skipped_at.
CREATE TABLE IF NOT EXISTS task_skip_requests (
  id TEXT PRIMARY KEY,
  daily_task_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,             -- child | parent
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled | revoked
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (daily_task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_skip_requests_task ON task_skip_requests(daily_task_id);
CREATE INDEX IF NOT EXISTS idx_task_skip_requests_status ON task_skip_requests(status, requested_at);

-- School timetables, one per child and term. With ab_weeks, some lessons alternate weekly: the
-- week (Monday to Sunday) containing ab_anchor_date is an A week, the next a B week, and so on.
CREATE TABLE IF NOT EXISTS timetables (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL, -- YYYY-MM-DD, inclusive
  end_date TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
  ab_weeks INTEGER NOT NULL DEFAULT 0,
  ab_anchor_date TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timetables_child ON timetables(child_id, start_date);

-- A timetable's day: lessons and breaks such as 课间操 or 午休, in time order.
CREATE TABLE IF NOT EXISTS timetable_slots (
  id TEXT PRIMARY KEY,
  timetable_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'class', -- class | break
  label TEXT NOT NULL,                -- e.g. 第1节, 课间操
  start_time TEXT NOT NULL,           -- HH:MM
  end_time TEXT NOT NULL,
  FOREIGN KEY (timetable_id) REFERENCES timetables(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_timetable ON timetable_slots(timetable_id);

-- What is taught in a lesson slot on a weekday: every week, or only in A or B weeks.
CREATE TABLE IF NOT EXISTS timetable_lessons (
  id TEXT PRIMARY KEY,
  timetable_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,         -- 0 Sunday .. 6 Saturday
  week TEXT NOT NULL DEFAULT 'all', -- all | A | B
  subject TEXT NOT NULL,
  teacher TEXT,
  room TEXT,
  bring TEXT,                       -- what to bring, e.g. 水彩笔、调色盘
  FOREIGN KEY (timetable_id) REFERENCES timetables(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES timetable_slots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timetable_lessons_timetable ON timetable_lessons(timetable_id);

-- Classes outside school (课外班) on fixed weekdays; one class may be shared by several children.
-- With create_task, each lesson is also a check-in task that day.
CREATE TABLE IF NOT EXISTS outside_classes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  institution TEXT,
  location TEXT,
  teacher TEXT,
  days_of_week TEXT NOT NULL, -- JSON array, 0 Sunday .. 6 Saturday
  start_time TEXT NOT NULL,   -- HH:MM
  end_time TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,              -- null: no end date
  bring TEXT,
  note TEXT,
  create_task INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  assign_all INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Children a class is limited to (used only when outside_classes.assign_all = 0)
CREATE TABLE IF NOT EXISTS outside_class_children (
  class_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  PRIMARY KEY (class_id, child_id),
  FOREIGN KEY (class_id) REFERENCES outside_classes(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

-- One child's change to one lesson of a class: on leave, or moved to another date and time.
CREATE TABLE IF NOT EXISTS outside_class_exceptions (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,   -- the lesson's usual date
  kind TEXT NOT NULL,   -- leave | moved
  new_date TEXT,
  new_start_time TEXT,
  new_end_time TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (class_id, child_id, date),
  FOREIGN KEY (class_id) REFERENCES outside_classes(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

-- Make-up school days (调休上学日): a day a child goes to school following another weekday's tasks
-- and timetable, even on a weekend or inside a holiday period.
CREATE TABLE IF NOT EXISTS makeup_days (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,      -- YYYY-MM-DD
  acts_as INTEGER NOT NULL, -- the weekday followed, 0 Sunday .. 6 Saturday
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (child_id, date),
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);

-- Pending device pairings: a short code shown on an unauthorized device until a parent approves it.
-- Authorized devices themselves live in the authorized_tokens file, by token hash.
CREATE TABLE IF NOT EXISTS device_pairings (
  code TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- When each authorized device was last used (not restored from backups).
CREATE TABLE IF NOT EXISTS device_seen (
  token_hash TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL
);

-- Device authorization history for the parent console and the container log (not restored from backups).
CREATE TABLE IF NOT EXISTS device_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,   -- pair_requested, pair_rejected, approved, approve_failed, approve_blocked, revoked, file_added, file_removed
  source TEXT NOT NULL, -- web, cli or file
  device_id TEXT,       -- first 16 hex digits of the token hash, as shown in the device list
  label TEXT,
  actor TEXT,           -- the authorized device that acted from the parent console
  code TEXT,            -- the pairing code shown or entered
  ip TEXT,              -- X-Forwarded-For chain and connecting address, for reference only
  user_agent TEXT
);
