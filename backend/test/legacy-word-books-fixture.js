// A genuine pre-v43 archive has neither memberships nor triggers referencing their tables.
module.exports = function removeWordBooks(db) {
  require('./legacy-word-tests-fixture')(db);
  require('./legacy-word-study-scope-fixture')(db);
  db.exec('DROP TABLE IF EXISTS word_import_receipts');
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'word_book%'").all()) {
    db.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
  }
  db.exec('DROP TABLE IF EXISTS word_book_items; DROP TABLE IF EXISTS word_books');
};
