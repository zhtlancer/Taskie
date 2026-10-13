async function authRoutes(fastify, options) {
  const { authService } = options;

  fastify.post('/child-login', async (request, reply) => {
    const { child_id, pin } = request.body || {};
    const result = authService.loginChild(child_id, pin);

    if (!result.success) {
      return reply.code(result.status || 400).send({ error: result.error });
    }

    const token = fastify.jwt.sign({
      role: 'child',
      child_id: result.child.id,
      name: result.child.name
    });

    return reply.send({
      success: true,
      token,
      child_id: result.child.id,
      child: result.child
    });
  });

  fastify.post('/parent-login', async (request, reply) => {
    const { pin } = request.body || {};
    const result = authService.loginParent(pin);

    if (!result.success) {
      return reply.code(result.status || 400).send({ error: result.error });
    }

    const token = fastify.jwt.sign({
      role: 'parent'
    });

    return reply.send({
      success: true,
      token,
      role: 'parent'
    });
  });

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

    return reply.send(result);
  });
}

module.exports = authRoutes;
