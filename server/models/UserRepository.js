import BaseRepository from './BaseRepository.js';
import db from '../db/connection.js';

class UserRepository extends BaseRepository {
  constructor() { super('users'); }

  async findByEmail(email) {
    return db.get('SELECT * FROM users WHERE email = ?', [email]);
  }

  async findByUsername(username) {
    return db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async updateResetToken(userId, token, expiresAt) {
    return db.run('UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?', [token, expiresAt, userId]);
  }

  async findByResetToken(token) {
    return db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
  }

  async clearResetToken(userId) {
    return db.run('UPDATE users SET reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?', [userId]);
  }

  async updatePassword(userId, passwordHash) {
    return db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  }

  async blockUser(blockerId, blockedId) {
    await db.run(
      'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT (blocker_id, blocked_id) DO NOTHING',
      [blockerId, blockedId]
    );
    return true;
  }

  async unblockUser(blockerId, blockedId) {
    await db.run(
      'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
      [blockerId, blockedId]
    );
    return true;
  }

  async isBlocked(userId1, userId2) {
    const row = await db.get(
      'SELECT id FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      [userId1, userId2, userId2, userId1]
    );
    return !!row;
  }

  async getBlockedUserIds(userId) {
    const rows = await db.all(
      'SELECT blocked_id FROM blocked_users WHERE blocker_id = ? UNION SELECT blocker_id FROM blocked_users WHERE blocked_id = ?',
      [userId, userId]
    );
    return rows.map(r => r.blocked_id);
  }

  async set2FAStatus(userId, enabled) {
    return db.run('UPDATE users SET pawprint_2fa_enabled = ? WHERE id = ?', [enabled ? 1 : 0, userId]);
  }

  async setSuperSniffStatus(userId, enabled) {
    return db.run('UPDATE users SET super_sniff_enabled = ? WHERE id = ?', [enabled ? 1 : 0, userId]);
  }

  async setPawCode(userId, code, expiresAt) {
    return db.run('UPDATE users SET paw_code = ?, paw_code_expires_at = ? WHERE id = ?', [code, expiresAt, userId]);
  }

  async getPawCode(userId) {
    return db.get('SELECT paw_code, paw_code_expires_at, pawprint_2fa_enabled, email FROM users WHERE id = ?', [userId]);
  }

  async clearPawCode(userId) {
    return db.run('UPDATE users SET paw_code = NULL, paw_code_expires_at = NULL WHERE id = ?', [userId]);
  }

  async addTrustedDevice(userId, deviceToken, deviceInfo, expiresAt) {
    return db.run(
      `INSERT INTO trusted_devices (user_id, device_token, device_info, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (device_token) DO UPDATE
       SET user_id = EXCLUDED.user_id, device_info = EXCLUDED.device_info, expires_at = EXCLUDED.expires_at`,
      [userId, deviceToken, deviceInfo, expiresAt]
    );
  }

  async isDeviceTrusted(userId, deviceToken) {
    if (!deviceToken) return false;
    const row = await db.get(
      "SELECT id FROM trusted_devices WHERE user_id = ? AND device_token = ? AND expires_at > NOW()",
      [userId, deviceToken]
    );
    return !!row;
  }

  async clearTrustedDevices(userId) {
    return db.run('DELETE FROM trusted_devices WHERE user_id = ?', [userId]);
  }

  async setPawprintVerifyToken(userId, tokenHash, expiresAt) {
    return db.run('UPDATE users SET pawprint_verify_token_hash = ?, pawprint_verify_expires_at = ? WHERE id = ?', [tokenHash, expiresAt, userId]);
  }

  async findByPawprintVerifyTokenHash(tokenHash) {
    return db.get('SELECT * FROM users WHERE pawprint_verify_token_hash = ?', [tokenHash]);
  }

  async clearPawprintVerifyToken(userId) {
    return db.run('UPDATE users SET pawprint_verify_token_hash = NULL, pawprint_verify_expires_at = NULL WHERE id = ?', [userId]);
  }
}

export default new UserRepository();