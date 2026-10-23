// Only genuine older schemas may have their newer tables created by initDb.
const REQUIRED_TABLES = ['children', 'task_templates', 'daily_tasks', 'point_logs', 'badge_definitions', 'child_badges', 'mistake_records', 'settings', 'characters'];
const PERIOD_TABLES = ['periods', 'period_paused_templates', 'period_tasks', 'period_task_logs'];
const SCHEDULE_TABLES = ['timetables', 'timetable_slots', 'timetable_lessons', 'outside_classes', 'outside_class_children', 'outside_class_exceptions'];
const STUDY_TABLES = ['word_study_plans', 'word_study_states', 'word_study_days', 'word_study_batches', 'word_study_items', 'word_study_attempts'];
const HOMEWORK_TABLES = ['homework_records', 'homework_course_points', 'homework_sessions', 'homework_session_days'];
const TABLES = [...REQUIRED_TABLES, 'template_children', 'reward_items', 'reward_redemptions', ...PERIOD_TABLES, 'task_skip_requests', ...SCHEDULE_TABLES, 'makeup_days', 'task_backfill_events', 'task_day_snapshots', ...STUDY_TABLES, ...HOMEWORK_TABLES, 'study_legacy_corrections', 'outside_class_attendance', 'outside_class_fees', 'outside_class_changes', 'outside_class_revisions', 'photo_expectations'];

module.exports = { REQUIRED_TABLES, PERIOD_TABLES, SCHEDULE_TABLES, STUDY_TABLES, HOMEWORK_TABLES, TABLES };
