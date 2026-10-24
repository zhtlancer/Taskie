// Manual database edits or backups can leave business rows without their independent versions.
// Existing versions (including undo tombstones) are never changed. Reads can limit the repair
// to the child/class they are about to use. This sentinel cannot be a persisted hex/UUID token;
// after recovery, an edit based on it must conflict rather than overwrite unseen changes.
const UNAVAILABLE_REVISION = '!revision-unavailable';
function backfillClassRevisions(db, { childId, classId } = {}) {
  const filters = [], params = [];
  if (childId !== undefined) { filters.push('a.child_id = ?'); params.push(childId); }
  if (classId !== undefined) { filters.push('a.class_id = ?'); params.push(classId); }
  const sources = [
    ['outside_class_attendance', 'attendance', 'a.lesson_date'],
    ['outside_class_fees', 'fee', "''"]
  ].map(([table, kind, date]) => ({ table, kind, date, where:
    [...filters, `NOT EXISTS (SELECT 1 FROM outside_class_revisions r
      WHERE r.class_id = a.class_id AND r.child_id = a.child_id
        AND r.kind = '${kind}' AND r.lesson_date = ${date})`].join(' AND ') }));
  // Normal reads need only indexed existence checks, with no write transaction or writer lock.
  if (!sources.some(({ table, where }) => db.prepare(`SELECT 1 FROM ${table} a WHERE ${where} LIMIT 1`).get(...params))) return;
  db.transaction(() => {
    for (const { table, kind, date, where } of sources) {
      db.prepare(`INSERT OR IGNORE INTO outside_class_revisions (class_id, child_id, kind, lesson_date, revision)
        SELECT a.class_id, a.child_id, '${kind}', ${date}, lower(hex(randomblob(16))) FROM ${table} a
        WHERE ${where}`).run(...params);
    }
  })();
}

function repairClassRevisions(db, scope, { forWrite = false } = {}) {
  try { backfillClassRevisions(db, scope); }
  catch (error) {
    console.warn('[Class revisions] 补齐版本失败', { ...scope, code: error.code, message: error.message });
    if (forWrite) throw { status: 503, message: '暂时无法保存，请稍后重试' };
  }
}

module.exports = { backfillClassRevisions, repairClassRevisions, UNAVAILABLE_REVISION };
