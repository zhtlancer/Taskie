// Priorities are persisted on sources and snapshotted on each daily occurrence.
const NORMAL_PRIORITY = 1;

function validatePriority(priority = NORMAL_PRIORITY) {
  if (![0, 1, 2].includes(priority)) throw { status: 400, message: '优先级必须为低、普通或高' };
  return priority;
}

function describePriority(row) {
  return { priority: row.priority_override ?? row.priority ?? NORMAL_PRIORITY,
    default_priority: row.priority ?? NORMAL_PRIORITY, priority_override: row.priority_override ?? null };
}

module.exports = { NORMAL_PRIORITY, validatePriority, describePriority };
