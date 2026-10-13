async function charactersRoutes(fastify, options) {
  const { charactersService } = options;

  fastify.get('/', async (request, reply) => {
    const { child_id, is_mastered } = request.query || {};
    try {
      const list = charactersService.listCharacters({ child_id, is_mastered });
      return reply.send(list);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.get('/:id', async (request, reply) => {
    const character = charactersService.getCharacter(request.params.id);
    if (!character) {
      return reply.code(404).send({ error: 'Character not found' });
    }
    return reply.send(character);
  });

  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body || {};
      const created = charactersService.createCharacter(body);
      return reply.code(201).send(created);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.put('/:id/master', async (request, reply) => {
    try {
      const isMastered = request.body && request.body.is_mastered !== undefined
        ? request.body.is_mastered
        : null;
      const updated = charactersService.markMastered(request.params.id, isMastered);
      return reply.send(updated);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = charactersService.deleteCharacter(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = charactersRoutes;
