const { createHash } = require('node:crypto');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;

// Called synchronously inside generationWrite's restore lock and database transaction.
function formSubmission(db, request, kind, childId, create, get) {
  const { request_id: id, ...body } = request.body || {};
  if (id === undefined) return create(body); // Older clients remain compatible.
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw { status: 400, message: '表单提交标识无效' };
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  const prior = db.prepare('SELECT * FROM form_submission_receipts WHERE id = ?').get(id);
  if (prior) {
    if (prior.kind !== kind || prior.child_id !== childId || prior.actor !== request.user.role || prior.fingerprint !== fingerprint) {
      throw { status: 409, code: 'FORM_SUBMISSION_CONFLICT', message: '原提交内容已改变，请核对记录后重新填写' };
    }
    const record = get(prior.record_id);
    if (!record || record.child_id !== childId) throw { status: 409, code: 'FORM_SUBMISSION_GONE', message: '原操作已保存，但记录已被删除或归属已变化，请核对后重新填写' };
    return record;
  }
  const record = create(body);
  db.prepare(`INSERT INTO form_submission_receipts(id, kind, child_id, actor, fingerprint, record_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, kind, childId, request.user.role, fingerprint, record.id, new Date().toISOString());
  return record;
}
module.exports = { formSubmission };
