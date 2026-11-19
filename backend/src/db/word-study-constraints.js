// States need a live source; items may outlive it and keep their learning snapshot.
const STATE_SOURCE_CHECK = `CHECK (
  (language = 'zh' AND character_id IS NOT NULL AND english_word_id IS NULL) OR
  (language = 'en' AND character_id IS NULL AND english_word_id IS NOT NULL)
)`;
const ITEM_SOURCE_CHECK = 'CHECK (character_id IS NULL OR english_word_id IS NULL)';

function validateWordStudyConstraints(db) {
  const compact = sql => sql.replace(/\s+/g, '').toLowerCase();
  for (const [table, check, deletion] of [
    ['word_study_states', STATE_SOURCE_CHECK, 'CASCADE'],
    ['word_study_items', ITEM_SOURCE_CHECK, 'SET NULL']
  ]) {
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', table)?.sql;
    if (!sql || !compact(sql).includes(compact(check))) throw new Error('Missing study source constraint');
    const keys = db.pragma(`foreign_key_list(${table})`);
    for (const [column, target] of [['character_id', 'characters'], ['english_word_id', 'english_words']]) {
      if (!keys.some(key => key.from === column && key.table === target && key.to === 'id' && key.on_delete === deletion)) {
        throw new Error('Invalid study source foreign key');
      }
    }
  }
  const indexes = db.pragma('index_list(word_study_states)').filter(index => index.unique && !index.partial);
  for (const column of ['character_id', 'english_word_id']) {
    if (!indexes.some(index => {
      const columns = db.pragma(`index_info('${index.name.replaceAll("'", "''")}')`).map(info => info.name);
      return columns.length === 2 && columns[0] === column && columns[1] === 'skill';
    })) throw new Error('Missing study source uniqueness');
  }
  // Backups can have been modified with ignore_check_constraints or writable_schema.
  if (db.prepare(`SELECT 1 FROM word_study_states WHERE NOT (
      (language = 'zh' AND character_id IS NOT NULL AND english_word_id IS NULL) OR
      (language = 'en' AND character_id IS NULL AND english_word_id IS NOT NULL)
    ) OR language IS NULL LIMIT 1`).get() ||
    db.prepare('SELECT 1 FROM word_study_items WHERE character_id IS NOT NULL AND english_word_id IS NOT NULL LIMIT 1').get()) {
    throw new Error('Invalid study source data');
  }
}

module.exports = { STATE_SOURCE_CHECK, ITEM_SOURCE_CHECK, validateWordStudyConstraints };
