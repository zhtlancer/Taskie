const { createHash } = require('node:crypto');

// Compare only editable content; ticking timers and independent review states must not conflict.
const editVersion = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
function requireEditVersion(expected, current) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw { status: 400, message: '请重新读取记录后再修改' };
  if (expected !== current) throw { status: 409, code: 'EDIT_CONFLICT', message: '记录刚被其他设备修改过，请重新读取并核对后再保存' };
}

module.exports = { editVersion, requireEditVersion };
