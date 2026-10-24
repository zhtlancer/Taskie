// Manual database edits or backups can leave business rows without their independent versions.
// Persist a real version rather than inventing a read-only fallback: schedule, statistics and
// optimistic writes must all use the same token. Existing versions (including undo tombstones)
// are never changed. Reads can limit the repair to the child/class they are about to use.
function backfillClassRevisions(db, { childId, classId } = {}) {
  const filters = [], params = [];
  if (childId !== undefined) { filters.push('a.child_id = ?'); params.push(childId); }
  if (classId !== undefined) { filters.push('a.class_id = ?'); params.push(classId); }
  db.transaction(() => {
    for (const [table, kind, date] of [
      ['outside_class_attendance', 'attendance', 'a.lesson_date'],
      ['outside_class_fees', 'fee', "''"]
    ]) {
      db.prepare(`INSERT OR IGNORE INTO outside_class_revisions (class_id, child_id, kind, lesson_date, revision)
        SELECT a.class_id, a.child_id, '${kind}', ${date}, lower(hex(randomblob(16))) FROM ${table} a
        WHERE ${[...filters, `NOT EXISTS (SELECT 1 FROM outside_class_revisions r
          WHERE r.class_id = a.class_id AND r.child_id = a.child_id
            AND r.kind = '${kind}' AND r.lesson_date = ${date})`].join(' AND ')}`).run(...params);
    }
  })();
}

module.exports = { backfillClassRevisions };
