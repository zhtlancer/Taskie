function validateHomeworkContent(db) {
  if (!db.pragma('table_info(homework_records)').some(column => column.name === 'content_pending') ||
      db.prepare('SELECT 1 FROM homework_records WHERE content_pending IS NULL OR typeof(content_pending) != ? OR content_pending NOT IN (0, 1) LIMIT 1').get('integer')) {
    throw new Error('作业内容待补充标记无效');
  }
}
module.exports = { validateHomeworkContent };
