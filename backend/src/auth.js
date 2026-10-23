const { randomBytes } = require('node:crypto');

// Authorize the route selected by Fastify, not an encoded spelling of its URL.
const authorizationPath = request => request.routeOptions.url || request.raw.url.split('?')[0];

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
  app.decorate('requireCurrentSession', request => {
    const user = request.user;
    if (!user || !['parent', 'child'].includes(user.role) || user.epoch !== app.sessionEpoch() || user.exp * 1000 <= Date.now()) {
      throw Object.assign(new Error('会话已失效，请重新登录'), { statusCode: 401 });
    }
    if (user.role === 'child') {
      const child = db.prepare('SELECT session_epoch FROM children WHERE id = ?').get(user.child_id);
      if (!child) throw Object.assign(new Error('孩子账号已删除，请重新选择账号'), { statusCode: 401 });
      if ((child.session_epoch ?? null) !== (user.child_epoch ?? null)) throw Object.assign(new Error('孩子的 PIN 已更改，请重新登录'), { statusCode: 401 });
    }
  });
  app.decorate('requireChildAccess', (request, childId) => {
    if (request.user.role !== 'parent' && (!childId || request.user.child_id !== childId)) {
      throw Object.assign(new Error('无权访问其他孩子的数据'), { statusCode: 403 });
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    const url = authorizationPath(request);
    if (request.method === 'OPTIONS' || !url.startsWith('/api/') && !url.startsWith('/uploads/')) return;
    // Device pairing comes before signing in; the device gate already protects everything else.
    // The photo package download checks its own short-lived ticket (see backups.routes.js).
    if (request.method === 'GET' && url === '/api/backups/photos/export') return;
    if (url === '/api/health' || url.startsWith('/api/device/') || request.method === 'GET' && ['/api/children', '/api/auth/setup'].includes(url.replace(/\/$/, '')) ||
      request.method === 'POST' && ['/api/auth/parent-login', '/api/auth/child-login', '/api/auth/logout'].includes(url)) return;
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: '请先登录，或重新登录已过期的会话' }); }
    try { app.requireCurrentSession(request); }
    catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    // Until the default PIN is replaced, only changing it and calibrating the generation are allowed.
    if (request.user.role === 'parent' && !['/api/auth/parent-pin', '/api/auth/data-generation'].includes(url) &&
      db.prepare("SELECT value FROM settings WHERE key = 'parent_pin_is_default'").get()?.value === '1') {
      return reply.code(403).send({ error: '请先修改默认家长 PIN', code: 'PARENT_PIN_CHANGE_REQUIRED' });
    }
    const parentOnly = /^\/api\/(?:daily-tasks|homework)\/[^/]+\/study\/legacy\/?$/.test(url) || /^\/api\/children\/[^/]+\/word-study\/plans\/[^/]+\/?$/.test(url) || url.startsWith('/api/backups') || url === '/api/auth/parent-pin' || url.startsWith('/api/devices') ||
      url.startsWith('/api/task-templates') && request.method !== 'GET' ||
      /^\/api\/children(?:\/[^/]+)?\/?$/.test(url) && request.method !== 'GET' ||
      url.startsWith('/api/reward-items') && request.method !== 'GET' ||
      /^\/api\/redemptions\/?$/.test(url) || /^\/api\/redemptions\/[^/]+\/(?:approve|reject)\/?$/.test(url) ||
      /^\/api\/children\/[^/]+\/(?:periods|goals)\/?$/.test(url) && request.method !== 'GET' ||
      url.startsWith('/api/periods/') || /^\/api\/period-tasks\/[^/]+\/?$/.test(url) ||
      /^\/api\/children\/[^/]+\/adhoc-tasks\/?$/.test(url) && request.method !== 'GET' || url.startsWith('/api/adhoc-tasks/') ||
      /^\/api\/daily-tasks\/(?:backfill(?:\/day)?|[^/]+\/(?:backfill|undo-backfill))\/?$/.test(url) ||
      /^\/api\/daily-tasks\/[^/]+\/unskip\/?$/.test(url) ||
      /^\/api\/skip-requests\/?$/.test(url) || /^\/api\/skip-requests\/[^/]+\/(?:approve|reject)\/?$/.test(url) ||
      /^\/api\/children\/[^/]+\/timetables\/?$/.test(url) && request.method !== 'GET' || url.startsWith('/api/timetables/') ||
      url.startsWith('/api/outside-classes') || url.startsWith('/api/outside-class-exceptions/') ||
      /^\/api\/children\/[^/]+\/makeup-days\/?$/.test(url) && request.method !== 'GET' || url.startsWith('/api/makeup-days/') ||
      /^\/api\/homework\/[^/]+\/(?:task|reject-task|reject-completion)\/?$/.test(url) || /^\/api\/homework(?:-completion)?-requests\/?$/.test(url) ||
      url.startsWith('/api/homework-course-points') && request.method !== 'GET';
    if (parentOnly && request.user.role !== 'parent') return reply.code(403).send({ error: '需要家长权限' });
    if (url.startsWith('/uploads/')) {
      const photo = db.prepare('SELECT child_id FROM mistake_records WHERE photo_path = ?').get(`/uploads/${request.params['*']}`);
      if (!photo) return reply.code(404).send({ error: '照片不存在' });
      app.requireChildAccess(request, photo.child_id);
    }
  });
  app.addHook('preHandler', async request => {
    if (!request.user || request.user.role === 'parent') return;
    const url = authorizationPath(request);
    const child = url.match(/^\/api\/children\/([^/]+)/);
    if (child) app.requireChildAccess(request, request.params.id);
    if (url.startsWith('/api/daily-tasks/')) {
      const row = db.prepare('SELECT child_id FROM daily_tasks WHERE id = ?').get(request.params.id);
      if (row) app.requireChildAccess(request, row.child_id);
    }
    for (const [prefix, table] of [['/api/mistakes/', 'mistake_records'], ['/api/characters/', 'characters'], ['/api/redemptions/', 'reward_redemptions'], ['/api/skip-requests/', 'task_skip_requests'], ['/api/homework/', 'homework_records']]) {
      if (url.startsWith(prefix)) {
        const row = db.prepare(`SELECT child_id FROM ${table} WHERE id = ?`).get(request.params.id);
        if (row) app.requireChildAccess(request, row.child_id);
      }
    }
    // Children may log and undo progress only on their own holiday tasks.
    const periodOwner = url.startsWith('/api/period-tasks/')
      ? db.prepare('SELECT child_id FROM period_tasks WHERE id = ?').get(request.params.id)
      : url.startsWith('/api/period-task-logs/')
        ? db.prepare('SELECT t.child_id FROM period_task_logs l JOIN period_tasks t ON t.id = l.period_task_id WHERE l.id = ?').get(request.params.id)
        : null;
    if (periodOwner) app.requireChildAccess(request, periodOwner.child_id);
    if (url.replace(/\/$/, '') === '/api/daily-tasks' ||
      ['/api/mistakes', '/api/characters'].includes(url.replace(/\/$/, '')) && !request.isMultipart()) {
      app.requireChildAccess(request, request.method === 'GET' ? request.query.child_id : request.body?.child_id);
    }
  });
}

module.exports = { installAuthorization, getSetting };
