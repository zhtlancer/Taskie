// The server supplies a normalized sorting deadline; null on a long-term goal means none.
// Sorting copies the list, retaining API order for ties, including across timer refreshes.
const group = task => task.is_completed || task.is_skipped ? 2 : task.is_optional ? 1 : 0;
const deadline = task => task.sort_due_date ?? task.due_date ?? task.date ?? '9999-12-31';
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => group(a) - group(b) ||
    deadline(a).localeCompare(deadline(b)) || (b.priority ?? 1) - (a.priority ?? 1));
}

export function sortGoals(goals, dailyRows = {}) {
  const entries = goals.map(goal => ({ goal, ...dailyRows[goal.id],
    priority: dailyRows[goal.id]?.priority ?? goal.priority,
    is_completed: goal.is_completed || goal.today_logged,
    is_skipped: Boolean(dailyRows[goal.id]?.is_skipped), is_optional: !goal.daily_required,
    // A daily obligation affects the state group; its overall deadline stays the goal's end.
    date: null, due_date: null, sort_due_date: goal.end_date ?? null }));
  return sortTasks(entries).map(entry => entry.goal);
}
