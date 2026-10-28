const { verifyPin, hashPin } = require('../utils/crypto');
const config = require('../config');

class AuthService {
  constructor(db) {
    this.db = db;
  }

  loginChild(childId, pin) {
    if (!childId) {
      return { success: false, status: 400, error: '请选择孩子' };
    }

    const child = this.db.prepare('SELECT id, name, avatar_emoji, pin_hash, session_epoch FROM children WHERE id = ?').get(childId);
    if (!child) {
      return { success: false, status: 404, error: '孩子不存在' };
    }

    if (child.pin_hash) {
      if (!pin) {
        return { success: false, status: 401, error: '请输入孩子的 PIN 码' };
      }
      if (!verifyPin(pin, child.pin_hash)) {
        return { success: false, status: 401, error: 'PIN 码不正确' };
      }
    }

    return {
      success: true,
      child: {
        id: child.id,
        name: child.name,
        avatar_emoji: child.avatar_emoji
      },
      sessionEpoch: child.session_epoch ?? null
    };
  }

  loginParent(pin) {
    if (!pin) {
      return { success: false, status: 400, error: '请输入 PIN 码' };
    }

    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('parent_pin_hash');
    if (!row || !row.value) {
      return { success: false, status: 500, error: '尚未设置家长 PIN 码' };
    }

    if (!verifyPin(pin, row.value)) {
      return { success: false, status: 401, error: '家长 PIN 码不正确' };
    }

    return {
      success: true,
      role: 'parent',
      must_change_pin: this.isParentPinDefault()
    };
  }

  isParentPinDefault() {
    return this.db.prepare("SELECT value FROM settings WHERE key = 'parent_pin_is_default'").get()?.value === '1';
  }

  updateParentPin(oldPin, newPin) {
    if (typeof newPin !== 'string' || !/^\d{4}$/.test(newPin)) {
      return { success: false, status: 400, error: 'PIN 必须为 4 位数字' };
    }
    if (newPin === config.defaultParentPin) {
      return { success: false, status: 400, error: '新 PIN 不能使用默认 PIN，请换一个' };
    }
    if (newPin === oldPin) {
      return { success: false, status: 400, error: '新 PIN 不能与当前 PIN 相同' };
    }

    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('parent_pin_hash');
    if (row && row.value) {
      if (!oldPin || !verifyPin(oldPin, row.value)) {
        return { success: false, status: 401, error: '当前家长 PIN 码不正确' };
      }
    }

    const newHash = hashPin(newPin);
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO settings (key, value) VALUES ('parent_pin_hash', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(newHash);
      this.db.prepare(`
        INSERT INTO settings (key, value) VALUES ('parent_pin_is_default', '0')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
    })();

    return { success: true, message: '家长 PIN 码已更新' };
  }
}

module.exports = AuthService;
