import { shortDate } from './schedule.js';

export const classActionLabels = {
  leave: '请假', move: '调课', attended: '已上课', absent: '缺席',
  undoAttendance: '撤销确认', undoLeave: '撤销请假', undoMove: '撤销调课'
};

// Use the displayed lesson's actual date and the board's business date, never the device date.
export function boardClassActions(lesson, actualDate, today, asParent) {
  if (!asParent) return [];
  const hasRevision = Object.hasOwn(lesson, 'attendance_revision');
  if (['attended', 'absent', 'leave'].includes(lesson.attendance?.status)) return hasRevision ? ['undoAttendance'] : [];
  if (lesson.status === 'leave') return lesson.exception_id ? ['undoLeave'] : [];
  if (lesson.status === 'moved_out') return lesson.exception_id ? ['undoMove'] : [];
  const actions = ['leave', 'move'];
  if (actualDate <= today && hasRevision) actions.push('attended', 'absent');
  if (lesson.status === 'moved_in' && lesson.exception_id) actions.push('undoMove');
  return actions;
}

export function boardClassStatus(lesson) {
  const labels = [];
  if (lesson.status === 'moved_out') labels.push(`已调到 ${shortDate(lesson.moved_to.date)} 日`);
  if (lesson.moved_from) labels.push(`从 ${shortDate(lesson.moved_from)} 日调来`);
  if (lesson.attendance?.status === 'attended') labels.push('已上课');
  else if (lesson.attendance?.status === 'absent') labels.push('缺席');
  else if (lesson.status === 'leave' || lesson.attendance?.status === 'leave') labels.push('已请假');
  else if (lesson.status !== 'moved_out') labels.push('未确认');
  return labels;
}
