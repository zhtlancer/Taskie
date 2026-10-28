const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { initDb, TIMING_COLUMNS, WEEKLY_EXTRA_COLUMNS } = require('../db');
const { REQUIRED_TABLES, PERIOD_TABLES, SCHEDULE_TABLES, STUDY_TABLES, HOMEWORK_TABLES } = require('../services/backup-format');
const { MAX_PHOTO_SIZE } = require('./photo-limits');
const safeName = name => typeof name === 'string' && /^[\w-]+\.(?:jpg|jpeg|png|webp)$/i.test(name);
const fail = message => Object.assign(new Error(message), { statusCode: 400 });

// Only prepared files and small metadata cross the worker boundary. The live database,
// restore journal, recovery backup and atomic directory swap remain on the main thread.
function prepare({ archive, saved, staging, maxSize, currentSchemaVersion }) {
  let data, candidate;
  try {
    data = JSON.parse(gunzipSync(fs.readFileSync(archive), { maxOutputLength: maxSize }).toString());
    const validManifest = list => Array.isArray(list) && list.every(p => p && safeName(p.name) && Number.isSafeInteger(p.size) && p.size >= 0 && p.size <= MAX_PHOTO_SIZE && /^[0-9a-f]{64}$/.test(p.sha256));
    if (data.format !== 'taskie-backup' || ![1, 2].includes(data.version) || typeof data.database !== 'string' ||
      (data.version === 1 && (!data.photos || Array.isArray(data.photos))) || (data.version === 2 && (Object.hasOwn(data, 'photos') || !validManifest(data.photo_manifest) || new Set(data.photo_manifest.map(p => p.name)).size !== data.photo_manifest.length)) ||
      (data.missing_photos !== undefined && (!Array.isArray(data.missing_photos) || !data.missing_photos.every(safeName)))) throw fail('不是有效的 Taskie 备份包');
    if (data.version === 1 && (typeof data.photos !== 'object' || Object.hasOwn(data, 'photo_manifest'))) throw fail('备份照片格式混用');
    const photoNames = new Set(data.version === 2 ? data.photo_manifest.map(p => p.name) : Object.keys(data.photos));
    if ((data.missing_photos || []).some(name => photoNames.has(name)) || new Set(data.missing_photos || []).size !== (data.missing_photos || []).length) throw fail('备份照片清单重复或冲突');
    const database = Buffer.from(data.database, 'base64');
    if (database.subarray(0, 16).toString() !== 'SQLite format 3\0') throw fail('备份数据库无效');
    candidate = new Database(database);
    if (candidate.pragma('integrity_check', { simple: true }) !== 'ok' || candidate.pragma('foreign_key_check').length) throw fail('备份数据库完整性检查失败');
    const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
    const schemaVersion = candidate.pragma('user_version', { simple: true });
    if (!REQUIRED_TABLES.every(t => tables.includes(t)) || schemaVersion > currentSchemaVersion) throw fail('备份版本不兼容');
    if (schemaVersion >= 2 && (!tables.includes('template_children') ||
      !candidate.pragma('table_info(task_templates)').some(column => column.name === 'assign_all'))) {
      throw fail('备份缺少任务分配数据，无法恢复');
    }
    if (schemaVersion >= 3 && !['reward_items', 'reward_redemptions'].every(t => tables.includes(t))) {
      throw fail('备份缺少积分兑换数据，无法恢复');
    }
    if (schemaVersion >= 4 && !['source_template_id', 'template_created_at'].every(name =>
      candidate.pragma('table_info(daily_tasks)').some(column => column.name === name))) {
      throw fail('备份缺少任务历史快照，无法恢复');
    }
    if (schemaVersion >= 5 && (!PERIOD_TABLES.every(t => tables.includes(t)) ||
      !candidate.pragma('table_info(point_logs)').some(column => column.name === 'period_log_id'))) {
      throw fail('备份缺少假期数据，无法恢复');
    }
    if (schemaVersion >= 6 && !['activity_date', 'activity_title'].every(name =>
      candidate.pragma('table_info(point_logs)').some(column => column.name === name))) {
      throw fail('备份缺少积分历史快照，无法恢复');
    }
    if (schemaVersion >= 7 && !candidate.pragma('table_info(daily_tasks)').some(column => column.name === 'origin')) {
      throw fail('备份缺少临时任务数据，无法恢复');
    }
    const hasColumn = (table, name) => candidate.pragma(`table_info(${table})`).some(column => column.name === name);
    if (schemaVersion >= 8 && !(hasColumn('period_tasks', 'child_id') && hasColumn('period_task_logs', 'position') && hasColumn('daily_tasks', 'goal_id'))) {
      throw fail('备份缺少长期任务数据，无法恢复');
    }
    if (schemaVersion >= 9 && !hasColumn('characters', 'categories')) throw fail('备份缺少生字生词分类，无法恢复');
    if (schemaVersion >= 10 && !(tables.includes('task_skip_requests') &&
      ['skipped_at', 'skip_reason'].every(name => hasColumn('daily_tasks', name)))) {
      throw fail('备份缺少跳过申请数据，无法恢复');
    }
    if (schemaVersion >= 11 && !Object.entries(TIMING_COLUMNS).every(([table, columns]) =>
      Object.keys(columns).every(name => hasColumn(table, name)))) {
      throw fail('备份缺少任务用时数据，无法恢复');
    }
    if (schemaVersion >= 12 && !(SCHEDULE_TABLES.every(t => tables.includes(t)) && hasColumn('daily_tasks', 'class_id'))) {
      throw fail('备份缺少课程表数据，无法恢复');
    }
    if (schemaVersion >= 13 && !hasColumn('daily_tasks', 'class_lesson_date')) {
      throw fail('备份缺少课次数据，无法恢复');
    }
    if (schemaVersion >= 14 && !(tables.includes('makeup_days') && hasColumn('task_templates', 'carry_over') &&
      ['carry_over', 'due_date'].every(name => hasColumn('daily_tasks', name)))) {
      throw fail('备份缺少顺延和调休数据，无法恢复');
    }
    if (schemaVersion >= 15 && (!tables.includes('task_backfill_events') || !hasColumn('daily_tasks', 'completion_source'))) {
      throw fail('备份缺少家长补卡记录，无法恢复');
    }
    if (schemaVersion >= 16 && !Object.entries(WEEKLY_EXTRA_COLUMNS).every(([table, columns]) =>
      Object.keys(columns).every(name => hasColumn(table, name)))) {
      throw fail('备份缺少每周额外完成和奖励数据，无法恢复');
    }
    if (schemaVersion >= 17 && (!STUDY_TABLES.every(table => tables.includes(table)) ||
      !hasColumn('daily_tasks', 'study_day_id') || !hasColumn('point_logs', 'study_batch_id'))) {
      throw fail('备份缺少字词学习计划数据，无法恢复');
    }
    if (schemaVersion >= 18 && !tables.includes('task_day_snapshots')) throw fail('备份缺少每日任务快照，无法恢复');
    if (schemaVersion >= 19 && !['homework_records', 'homework_course_points'].every(table => tables.includes(table))) throw fail('备份缺少作业记录，无法恢复');
    if (schemaVersion >= 20 && !hasColumn('homework_records', 'course_key')) throw fail('备份缺少作业课程标识，无法恢复');
    if (schemaVersion >= 21 && (!HOMEWORK_TABLES.every(table => tables.includes(table)) || !hasColumn('daily_tasks', 'homework_legacy_seconds') || !hasColumn('homework_records', 'completion_requested_at'))) throw fail('备份缺少分次学习记录，无法恢复');
    if (schemaVersion >= 22 && !hasColumn('daily_tasks', 'revoked_at')) throw fail('备份缺少已取消任务标记，无法恢复');
    if (schemaVersion >= 23 && !hasColumn('daily_tasks', 'finish_on_actual_date')) throw fail('备份缺少完成时间归属，无法恢复');
    if (schemaVersion >= 24 && (!tables.includes('study_legacy_corrections') ||
      !['id', 'task_id', 'child_id', 'old_seconds', 'new_seconds', 'reason', 'actor', 'created_at'].every(name => hasColumn('study_legacy_corrections', name)))) throw fail('备份缺少旧累计更正记录，无法恢复');
    if (schemaVersion >= 25 && !hasColumn('daily_tasks', 'is_course_homework')) throw fail('备份缺少课程作业来源，无法恢复');
    if (schemaVersion >= 26 && !['last_timer_kind', 'last_timer_id'].every(name => hasColumn('children', name))) throw fail('备份缺少最近计时记录，无法恢复');
    if (schemaVersion >= 27 && !hasColumn('outside_classes', 'total_lessons')) throw fail('备份缺少课外班总课次，无法恢复');
    if (schemaVersion >= 28 && (!['class_id', 'child_id', 'lesson_date', 'actual_date', 'start_time', 'end_time', 'duration_minutes', 'status', 'charged', 'source', 'task_id', 'note', 'updated_at'].every(name => hasColumn('outside_class_attendance', name)) ||
      !['class_id', 'child_id', 'total_fee_cents', 'updated_at'].every(name => hasColumn('outside_class_fees', name)))) throw fail('备份缺少课外班出勤或学费记录，无法恢复');
    if (schemaVersion >= 29 && (!hasColumn('children', 'session_epoch') || !tables.includes('outside_class_changes') ||
      !['id', 'class_id', 'child_id', 'kind', 'lesson_date', 'old_value', 'new_value', 'created_at'].every(name => hasColumn('outside_class_changes', name)))) throw fail('备份缺少出勤学费修改记录或孩子会话版本，无法恢复');
    if (schemaVersion >= 30 && (!['photo_expectations', 'outside_class_revisions'].every(t => tables.includes(t)) ||
      !['name', 'size', 'sha256'].every(name => hasColumn('photo_expectations', name)) ||
      !['class_id', 'child_id', 'kind', 'lesson_date', 'revision'].every(name => hasColumn('outside_class_revisions', name)) || !hasColumn('period_task_logs', 'request_fingerprint'))) throw fail('备份缺少照片校验或独立版本数据，无法恢复');
    if (schemaVersion >= 31 && (!tables.includes('study_completion_requests') ||
      !['id', 'task_id', 'request_fingerprint', 'created_at'].every(name => hasColumn('study_completion_requests', name)))) throw fail('备份缺少任务完成请求凭据，无法恢复');
    if (schemaVersion >= 32 && (!['task_templates', 'daily_tasks', 'homework_records', 'period_tasks'].every(table => hasColumn(table, 'priority')) ||
      !hasColumn('daily_tasks', 'priority_override'))) throw fail('备份缺少任务优先级数据，无法恢复');
    if (schemaVersion >= 33 && (!['refund_reason', 'refunded_at'].every(name => hasColumn('reward_redemptions', name)) ||
      !tables.includes('form_submission_receipts') ||
      !['id', 'kind', 'child_id', 'actor', 'fingerprint', 'record_id', 'created_at'].every(name => hasColumn('form_submission_receipts', name)))) {
      throw fail('备份缺少兑换撤销记录或表单提交凭据，无法恢复');
    }
    if (!candidate.prepare("SELECT value FROM settings WHERE key = 'parent_pin_hash'").get()) throw fail('备份缺少家长账号');
    // initDb also backfills missing attendance/fee revisions on current-schema backups,
    // before the candidate is serialized and copied into the live database.
    initDb(candidate);
    for (const [name, value] of Object.entries(data.photos || {})) {
      if (!safeName(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw fail('备份照片路径或内容无效');
    }
    candidate.prepare('DELETE FROM photo_expectations').run();
    const expectation = candidate.prepare('INSERT INTO photo_expectations VALUES (?, ?, ?)');
    for (const photo of data.photo_manifest || []) expectation.run(photo.name, photo.size, photo.sha256);
    for (const [name, value] of Object.entries(data.photos || {})) {
      const content = Buffer.from(value, 'base64');
      if (content.length > MAX_PHOTO_SIZE) throw fail('备份单张照片超过 10 MiB');
      expectation.run(name, content.length, createHash('sha256').update(content).digest('hex'));
    }
    const listed = new Set([...Object.keys(data.photos || {}), ...(data.photo_manifest || []).map(p => p.name), ...(data.missing_photos || [])]);
    for (const name of candidate.prepare("SELECT DISTINCT photo_path FROM mistake_records WHERE photo_path LIKE '/uploads/%'").all().map(row => row.photo_path.slice('/uploads/'.length))) {
      if (!listed.has(name)) throw fail('备份缺少关联照片');
    }
    for (const [name, content] of Object.entries(data.photos || {})) fs.writeFileSync(path.join(staging, name), Buffer.from(content, 'base64'), { mode: 0o600 });
    fs.writeFileSync(saved, candidate.serialize(), { mode: 0o600 });
    candidate.close();
    candidate = null;
    return { photo_manifest: data.photo_manifest || [], missing_photos: data.missing_photos || [] };
  } catch (error) {
    if (candidate) candidate.close();
    throw fail(error.statusCode ? error.message : '备份包损坏或无法读取');
  }

}
try { parentPort.postMessage({ result: prepare(workerData) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
