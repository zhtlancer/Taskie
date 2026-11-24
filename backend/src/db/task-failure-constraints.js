const FAILURE_COLUMNS = {
  failure_id: 'TEXT', failed_at: 'TEXT', failure_reason: 'TEXT',
  failure_penalty: "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(failure_penalty) = 'integer' AND failure_penalty BETWEEN 0 AND 10000)"
};

function validateTaskFailures(db) {
  const columns = db.pragma('table_info(daily_tasks)').map(c => c.name);
  if (Object.keys(FAILURE_COLUMNS).some(name => !columns.includes(name))) throw new Error('缺少未完成确认字段');
  db.prepare('SELECT id, task_id, child_id, reason, penalty, fingerprint, confirmed_at, restored_at FROM task_failures LIMIT 0').all();
  if (db.prepare(`SELECT 1 FROM daily_tasks d LEFT JOIN task_failures f ON f.id = d.failure_id WHERE
    (d.failure_id IS NULL AND (d.failed_at IS NOT NULL OR d.failure_reason IS NOT NULL OR d.failure_penalty != 0)) OR
    (d.failure_id IS NOT NULL AND (f.id IS NULL OR f.task_id != d.id OR f.child_id != d.child_id OR f.restored_at IS NOT NULL
      OR d.is_completed != 0 OR d.skipped_at IS NOT NULL OR d.revoked_at IS NOT NULL OR d.origin NOT IN ('template', 'adhoc')
      OR d.failed_at IS NOT f.confirmed_at OR d.failure_reason IS NOT f.reason OR d.failure_penalty != f.penalty)) LIMIT 1`).get()) throw new Error('未完成确认状态无效');
  if (db.prepare(`SELECT 1 FROM task_failures f LEFT JOIN daily_tasks d ON d.id = f.task_id
    LEFT JOIN point_logs p ON p.id = 'failure:' || f.id WHERE
    d.id IS NULL OR d.child_id != f.child_id OR length(trim(f.reason)) NOT BETWEEN 1 AND 150 OR
    typeof(f.penalty) != 'integer' OR f.penalty NOT BETWEEN 0 AND 10000 OR length(f.fingerprint) = 0 OR
    (f.restored_at IS NULL AND (d.failure_id IS NOT f.id OR
      (f.penalty > 0 AND (p.id IS NULL OR p.child_id != f.child_id OR p.daily_task_id IS NOT f.task_id OR p.points != -f.penalty OR p.activity_date IS NOT d.date)) OR
      (f.penalty = 0 AND p.id IS NOT NULL))) OR
    (f.restored_at IS NOT NULL AND (d.failure_id IS f.id OR p.id IS NOT NULL)) LIMIT 1`).get()) throw new Error('未完成确认记录或扣分无效');
}
module.exports = { FAILURE_COLUMNS, validateTaskFailures };
