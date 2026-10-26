// The server supplies a normalized sorting deadline; null on a long-term goal means none.
// Sorting copies the list, retaining API order for ties, including across timer refreshes.
const group = task => task.is_completed || task.is_skipped ? 2 : task.is_optional ? 1 : 0;
const deadline = task => task.sort_due_date ?? task.due_date ?? task.date ?? '9999-12-31';
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => group(a) - group(b) ||
    deadline(a).localeCompare(deadline(b)) || (b.priority ?? 1) - (a.priority ?? 1));
}

export function sortGoals(goals, dailyRows = {}) {
  return sortTasks(goals.map(goal => goalBoardTask(goal, dailyRows[goal.id]))).map(entry => entry.goal);
}

export function goalBoardTask(goal, dailyRow) {
  return { ...dailyRow, goal, subject: goal.subject,
    priority: dailyRow?.priority ?? goal.priority,
    is_completed: goal.is_completed || goal.today_logged,
    is_skipped: Boolean(dailyRow?.is_skipped), is_optional: !goal.daily_required,
    // A daily obligation affects the state group; its overall deadline stays the goal's end.
    date: null, due_date: null, sort_due_date: goal.end_date ?? null };
}

export function matchesTaskFilters(task, { subject = '全部', unfinishedOnly = false, highPriorityOnly = false } = {}) {
  return (subject === '全部' || task.subject === subject) &&
    (!unfinishedOnly || !task.is_completed && !task.is_skipped) &&
    (!highPriorityOnly || task.priority === 2);
}

export function taskAttention(tasks, goals, today) {
  const dailyRows = Object.fromEntries(tasks.filter(task => task.origin === 'goal').map(task => [task.goal_id, task]));
  const pending = [
    ...tasks.filter(task => task.origin !== 'goal' && !task.is_extra),
    ...goals.filter(goal => goal.status === 'active').map(goal => goalBoardTask(goal, dailyRows[goal.id]))
  ].filter(task => matchesTaskFilters(task, { unfinishedOnly: true }));
  return { due_today: pending.filter(task => deadline(task) === today).length,
    high_priority_pending: pending.filter(task => task.priority === 2).length };
}
