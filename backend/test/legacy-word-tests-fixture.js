module.exports = function removeTests(db) {
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'word_test%'")
    .all())
    db.exec(`DROP TRIGGER "${name}"`);
  db.exec('DROP TABLE IF EXISTS word_test_items; DROP TABLE IF EXISTS word_tests');
  db.prepare("DELETE FROM form_submission_receipts WHERE kind LIKE 'word-test-%'").run();
};
