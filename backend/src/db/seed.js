const { getDb } = require('./index');
const { generateId, hashPin } = require('../utils/crypto');

function seedDemoData(dbInstance) {
  const db = dbInstance || getDb();

  console.log('Seeding demo data...');

  // 1. Seed demo children if none exist
  const childCount = db.prepare('SELECT COUNT(*) as count FROM children').get().count;
  let mingId, hongId;
  if (childCount === 0) {
    mingId = generateId();
    hongId = generateId();
    const now = new Date().toISOString();

    const insertChild = db.prepare(`
      INSERT INTO children (id, name, avatar_emoji, pin_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertChild.run(mingId, '小明', '🐱', hashPin('1234'), now);
    insertChild.run(hongId, '小红', '🐰', null, now);
    console.log('Seeded demo children: 小明 (🐱, PIN 1234), 小红 (🐰, no PIN)');
  }

  // 2. Seed task templates if none exist
  const templateCount = db.prepare('SELECT COUNT(*) as count FROM task_templates').get().count;
  if (templateCount === 0) {
    const insertTemplate = db.prepare(`
      INSERT INTO task_templates (id, title, subject, days_of_week, points, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const demoTemplates = [
      { title: '语文朗读', subject: '语文', days: [1, 2, 3, 4, 5], points: 10 },
      { title: '数学练习册', subject: '数学', days: [1, 2, 3, 4, 5], points: 10 },
      { title: '英语单词', subject: '英语', days: [1, 2, 3, 4, 5], points: 15 },
      { title: '课外阅读20页', subject: '其他', days: [0, 1, 2, 3, 4, 5, 6], points: 15 },
      { title: '跳绳300个', subject: '其他', days: [0, 1, 2, 3, 4, 5, 6], points: 10 },
      { title: '整理书包与书桌', subject: '其他', days: [0, 6], points: 10 }
    ];

    for (const t of demoTemplates) {
      insertTemplate.run(generateId(), t.title, t.subject, JSON.stringify(t.days), t.points, now);
    }
    console.log(`Seeded ${demoTemplates.length} demo task templates.`);
  }

  // 3. Seed sample characters if none exist
  const characterCount = db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
  if (characterCount === 0) {
    const child = db.prepare('SELECT id FROM children ORDER BY created_at ASC LIMIT 1').get();
    if (child) {
      const insertChar = db.prepare(`
        INSERT INTO characters (id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      insertChar.run(generateId(), child.id, '学', 'xué', 8, '子', 0, now, null);
      insertChar.run(generateId(), child.id, '习', 'xí', 3, '羽', 1, now, now);
      insertChar.run(generateId(), child.id, '春', 'chūn', 9, '日', 0, now, null);
      console.log('Seeded demo characters (学, 习, 春).');
    }
  }

  console.log('Demo seed completed successfully.');
}

if (require.main === module) {
  seedDemoData();
}

module.exports = { seedDemoData };
