const { generateId } = require('../utils/crypto');

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

function validateItemFields({ title, icon_emoji, cost }, { partial = false } = {}) {
  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 50) {
      throw { status: 400, message: '奖励名称不能为空，且不超过 50 个字' };
    }
  }
  if (icon_emoji !== undefined && (typeof icon_emoji !== 'string' || !icon_emoji.trim() || icon_emoji.length > 16)) {
    throw { status: 400, message: '奖励图标无效' };
  }
  if (!partial || cost !== undefined) {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100000) {
      throw { status: 400, message: '所需积分必须为 1 至 100000 的整数' };
    }
  }
}

class RedemptionsService {
  constructor(db, rewardsService) {
    this.db = db;
    this.rewardsService = rewardsService;
  }

  // --- Reward items ---

  listItems({ includeInactive = false } = {}) {
    return this.db.prepare(`
      SELECT * FROM reward_items
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY cost ASC, created_at ASC
    `).all().map(item => ({ ...item, is_active: Boolean(item.is_active) }));
  }

  getItem(id) {
    const item = this.db.prepare('SELECT * FROM reward_items WHERE id = ?').get(id);
    return item ? { ...item, is_active: Boolean(item.is_active) } : null;
  }

  createItem({ title, icon_emoji = '🎁', cost }) {
    validateItemFields({ title, icon_emoji, cost });
    const id = generateId();
    this.db.prepare(`
      INSERT INTO reward_items (id, title, icon_emoji, cost, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, title.trim(), icon_emoji.trim(), cost, new Date().toISOString());
    return this.getItem(id);
  }

  updateItem(id, { title, icon_emoji, cost, is_active }) {
    const existing = this.getItem(id);
    if (!existing) throw { status: 404, message: '奖励不存在' };
    validateItemFields({ title, icon_emoji, cost }, { partial: true });
    if (is_active !== undefined && typeof is_active !== 'boolean') throw { status: 400, message: '上架状态无效' };
    this.db.prepare(`
      UPDATE reward_items SET title = ?, icon_emoji = ?, cost = ?, is_active = ? WHERE id = ?
    `).run(
      title !== undefined ? title.trim() : existing.title,
      icon_emoji !== undefined ? icon_emoji.trim() : existing.icon_emoji,
      cost ?? existing.cost,
      (is_active ?? existing.is_active) ? 1 : 0,
      id
    );
    return this.getItem(id);
  }

  // Redemptions keep their own snapshot of the reward, so history is unaffected.
  deleteItem(id) {
    if (!this.getItem(id)) throw { status: 404, message: '奖励不存在' };
    this.db.prepare('DELETE FROM reward_items WHERE id = ?').run(id);
    return { success: true, id };
  }

  // --- Redemptions ---

  listRedemptions({ childId, status, limit = 200, offset = 0 } = {}) {
    if (status !== undefined && ![...STATUSES, 'history'].includes(status)) throw { status: 400, message: '兑换状态无效' };
    const parseInteger = value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    limit = parseInteger(limit);
    offset = parseInteger(offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      throw { status: 400, message: '分页参数无效' };
    }
    const where = [], params = [];
    if (childId) { where.push('r.child_id = ?'); params.push(childId); }
    if (status === 'history') where.push("r.status != 'pending'");
    else if (status) { where.push('r.status = ?'); params.push(status); }
    return this.db.prepare(`
      SELECT r.*, c.name AS child_name, c.avatar_emoji AS child_avatar_emoji
      FROM reward_redemptions r
      JOIN children c ON c.id = r.child_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.requested_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  }

  getRedemption(id) {
    return this.db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(id) || null;
  }

  requestRedemption(childId, rewardId) {
    let id;
    this.db.transaction(() => {
      if (!this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId)) throw { status: 404, message: 'Child not found' };
      const item = rewardId && this.getItem(rewardId);
      if (!item || !item.is_active) throw { status: 404, message: '奖励不存在或已下架' };
      const available = this.rewardsService.getAvailablePoints(childId);
      if (available < item.cost) throw { status: 409, message: `积分不足：还差 ${item.cost - available} 分` };
      id = generateId();
      this.db.prepare(`
        INSERT INTO reward_redemptions (id, child_id, reward_id, title, icon_emoji, cost, status, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, childId, item.id, item.title, item.icon_emoji, item.cost, new Date().toISOString());
    })();
    return this.getRedemption(id);
  }

  // Only pending requests can move; approved points stay spent and rejected/cancelled ones are released.
  resolveRedemption(id, status) {
    const redemption = this.getRedemption(id);
    if (!redemption) throw { status: 404, message: '兑换记录不存在' };
    if (redemption.status !== 'pending') throw { status: 409, message: '该兑换申请已处理' };
    this.db.prepare('UPDATE reward_redemptions SET status = ?, resolved_at = ? WHERE id = ? AND status = ?')
      .run(status, new Date().toISOString(), id, 'pending');
    return this.getRedemption(id);
  }
}

module.exports = RedemptionsService;
