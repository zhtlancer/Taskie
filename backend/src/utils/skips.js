// Doing a task (or logging a long-term task's progress) that day withdraws a skip request
// still waiting for a parent.
function cancelPendingSkips(db, dailyTaskId, now = new Date().toISOString()) {
  db.prepare("UPDATE task_skip_requests SET status = 'cancelled', resolved_at = ? WHERE daily_task_id = ? AND status = 'pending'")
    .run(now, dailyTaskId);
}

module.exports = { cancelPendingSkips };
