const { randomBytes } = require('node:crypto');

function getSetting(db, key) {
  let row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) {
    const value = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    row = { value };
  }
  return row.value;
}

function installAuthorization(app, db) {
  app.decorate('sessionEpoch', () => getSetting(db, 'auth_epoch'));
  app.decorate('requireChildAccess', (request, childId) => {
    if (request.user.role !== 'parent' && (!childId || request.user.child_id !== childId)) {
      throw Object.assign(new Error('无权访问其他孩子的数据'), { statusCode: 403 });
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url.split('?')[0];
    if (request.method === 'OPTIONS' || !url.startsWith('/api/') && !url.startsWith('/uploads/')) return;
    if (url === '/api/health' || request.method === 'GET' && url.replace(/\/$/, '') === '/api/children' ||
      request.method === 'POST' && ['/api/auth/parent-login', '/api/auth/child-login', '/api/auth/logout'].includes(url)) return;
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: '请先登录，或重新登录已过期的会话' }); }
    if (!['parent', 'child'].includes(request.user.role) || request.user.epoch !== app.sessionEpoch()) {
      return reply.code(401).send({ error: '会话已失效，请重新登录' });
    }
    if (request.user.role === 'child' && !db.prepare('SELECT id FROM children WHERE id = ?').get(request.user.child_id)) {
      return reply.code(401).send({ error: '孩子账号已删除，请重新选择账号' });
    }
    const parentOnly = url.startsWith('/api/backups') || url === '/api/auth/parent-pin' ||
      url.startsWith('/api/task-templates') && request.method !== 'GET' ||
      /^\/api\/children(?:\/[^/]+)?\/?$/.test(url) && request.method !== 'GET';
    if (parentOnly && request.user.role !== 'parent') return reply.code(403).send({ error: '需要家长权限' });
    if (url.startsWith('/uploads/')) {
      const photo = db.prepare('SELECT child_id FROM mistake_records WHERE photo_path = ?').get(url);
      if (!photo) return reply.code(404).send({ error: '照片不存在' });
      app.requireChildAccess(request, photo.child_id);
    }
  });
  app.addHook('preHandler', async request => {
    if (!request.user || request.user.role === 'parent') return;
    const url = request.raw.url.split('?')[0];
    const child = url.match(/^\/api\/children\/([^/]+)/);
    if (child) app.requireChildAccess(request, child[1]);
    if (url.startsWith('/api/daily-tasks/')) {
      const row = db.prepare('SELECT child_id FROM daily_tasks WHERE id = ?').get(request.params.id);
      if (row) app.requireChildAccess(request, row.child_id);
    }
    for (const [prefix, table] of [['/api/mistakes/', 'mistake_records'], ['/api/characters/', 'characters']]) {
      if (url.startsWith(prefix)) {
        const row = db.prepare(`SELECT child_id FROM ${table} WHERE id = ?`).get(request.params.id);
        if (row) app.requireChildAccess(request, row.child_id);
      }
    }
    if (url.replace(/\/$/, '') === '/api/daily-tasks' ||
      ['/api/mistakes', '/api/characters'].includes(url.replace(/\/$/, '')) && !request.isMultipart()) {
      app.requireChildAccess(request, request.method === 'GET' ? request.query.child_id : request.body?.child_id);
    }
  });
}

module.exports = { installAuthorization, getSetting };
