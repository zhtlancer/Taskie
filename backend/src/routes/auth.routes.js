async function authRoutes(fastify, options) {
  const { authService } = options;
  const attempts = new Map();
  const allowLogin = (request, reply, kind) => {
    const key = `${request.ip}:${kind}:${kind === 'child' ? request.body?.child_id : 'parent'}`;
    const attempt = attempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.failures >= 10) {
      reply.header('Retry-After', Math.ceil((attempt.until - Date.now()) / 1000));
      reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      return false;
    }
    if (attempt && attempt.until <= Date.now()) attempts.delete(key);
    return true;
  };
  const recordLogin = (request, kind, success) => {
    const key = `${request.ip}:${kind}:${kind === 'child' ? request.body?.child_id : 'parent'}`;
    if (success) { attempts.delete(key); return; }
    if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value);
    const previous = attempts.get(key) || { failures: 0, until: Date.now() + 15 * 60000 };
    previous.failures++;
    attempts.set(key, previous);
  };

  fastify.post('/child-login', async (request, reply) => {
    if (!allowLogin(request, reply, 'child')) return;
    const { child_id, pin } = request.body || {};
    const result = authService.loginChild(child_id, pin);
    recordLogin(request, 'child', result.success);

    if (!result.success) {
      return reply.code(result.status || 400).send({ error: result.error });
    }

    const token = fastify.jwt.sign({
      role: 'child',
      child_id: result.child.id,
      name: result.child.name,
      epoch: fastify.sessionEpoch(),
      // Changing this child's PIN changes it, signing out only this child's devices.
      child_epoch: result.sessionEpoch
    });

    return reply.send({
      success: true,
      token,
      child_id: result.child.id,
      child: result.child
    });
  });

  fastify.post('/parent-login', async (request, reply) => {
    if (!allowLogin(request, reply, 'parent')) return;
    const { pin } = request.body || {};
    const result = authService.loginParent(pin);
    recordLogin(request, 'parent', result.success);

    if (!result.success) {
      return reply.code(result.status || 400).send({ error: result.error });
    }

    const token = fastify.jwt.sign({
      role: 'parent',
      epoch: fastify.sessionEpoch()
    });

    return reply.send({
      success: true,
      token,
      role: 'parent',
      must_change_pin: result.must_change_pin
    });
  });

  // Public: lets the login page show the default-PIN hint only until it has been changed.
  fastify.get('/setup', async () => ({ parent_pin_is_default: authService.isParentPinDefault() }));

  fastify.post('/logout', async (request, reply) => {
    return reply.send({
      success: true,
      message: 'Logged out successfully'
    });
  });

  fastify.put('/parent-pin', async (request, reply) => {
    const { old_pin, new_pin } = request.body || {};
    const result = authService.updateParentPin(old_pin, new_pin);

    if (!result.success) {
      return reply.code(result.status || 400).send({ error: result.error });
    }

    fastify.db.prepare("UPDATE settings SET value = ? WHERE key = 'auth_epoch'").run(require('node:crypto').randomBytes(32).toString('hex'));
    return reply.send(result);
  });
}

module.exports = authRoutes;
