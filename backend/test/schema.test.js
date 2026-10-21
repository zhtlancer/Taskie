const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDb, initDb, WEEKLY_EXTRA_COLUMNS } = require('../src/db');

const byName = (a, b) => a.name.localeCompare(b.name);

// Every table, column (ignoring order), foreign key and index, so a fresh database can be compared
// with one built by upgrades.
function describeSchema(db) {
  return db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    .map(({ type, name, tbl_name }) => type === 'table'
      ? { type, name,
        columns: db.pragma(`table_info(${name})`).map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })).sort(byName),
        foreign_keys: db.pragma(`foreign_key_list(${name})`).map(({ table, from, to, on_delete }) => `${from}->${table}.${to} ${on_delete}`).sort() }
      : { type, name, table: tbl_name,
        columns: db.pragma(`index_info(${name})`).map(column => column.name),
        unique: db.pragma(`index_list(${tbl_name})`).find(index => index.name === name)?.unique ?? null });
}

test('a database upgraded from v14 ends with the same schema as a fresh one', () => {
  const fresh = getDb(':memory:');
  const legacy = getDb(':memory:');
  // Undo what v15–v26 and their schema.sql tables add, as a v14 database would look.
  legacy.exec(`DROP INDEX idx_point_logs_study_batch; DROP INDEX idx_daily_tasks_study_day; DROP INDEX idx_point_logs_daily_task;
    ALTER TABLE point_logs DROP COLUMN study_batch_id; ALTER TABLE daily_tasks DROP COLUMN study_day_id;
    ALTER TABLE daily_tasks DROP COLUMN completion_source; DROP TABLE task_backfill_events; DROP TABLE task_day_snapshots; DROP TABLE study_legacy_corrections;
    DROP TABLE homework_session_days; DROP TABLE homework_sessions; ALTER TABLE daily_tasks DROP COLUMN homework_legacy_seconds; ALTER TABLE daily_tasks DROP COLUMN revoked_at; ALTER TABLE daily_tasks DROP COLUMN finish_on_actual_date; ALTER TABLE daily_tasks DROP COLUMN is_course_homework; ALTER TABLE children DROP COLUMN last_timer_kind; ALTER TABLE children DROP COLUMN last_timer_id; DROP TABLE homework_records; DROP TABLE homework_course_points;`);
  for (const table of ['word_study_attempts', 'word_study_items', 'word_study_batches', 'word_study_days', 'word_study_states', 'word_study_plans']) {
    legacy.exec(`DROP TABLE ${table}`);
  }
  for (const [table, columns] of Object.entries(WEEKLY_EXTRA_COLUMNS)) {
    for (const column of Object.keys(columns)) legacy.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  legacy.pragma('user_version = 14');
  assert.notDeepEqual(describeSchema(legacy), describeSchema(fresh));
  initDb(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), fresh.pragma('user_version', { simple: true }));
  assert.deepEqual(describeSchema(legacy), describeSchema(fresh));
  fresh.close();
  legacy.close();
});
