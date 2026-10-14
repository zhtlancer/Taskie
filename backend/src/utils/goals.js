const { formatDate } = require('./date');

// completed_at records when completion was entered; progress dates record when it happened.
function completedOn(task, lastProgressDate) {
  return task.completed_at ? lastProgressDate || formatDate(new Date(task.completed_at)) : null;
}

module.exports = { completedOn };
