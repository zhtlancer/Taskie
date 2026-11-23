// Remove post-v44 scope objects before constructing a genuine older archive.
module.exports = function removeScopes(db) {
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'word_study_day_scope%'").all()) db.exec(`DROP TRIGGER "${name}"`);
  db.exec('DROP TABLE IF EXISTS word_study_day_scope_items');
  for (const table of ['word_study_plans', 'word_study_days']) {
    const columns = new Set(db.pragma(`table_info(${table})`).map(column => column.name));
    for (const name of ['scope_mode', 'book_ids', 'scope_books', 'scope_excluded_no_definition', 'scope_excluded_pinyin']) if (columns.has(name)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
  }
};
