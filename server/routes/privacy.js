import { Router } from 'express';
import { authenticateAccess, revokeAllUserTokens } from '../middleware/auth.js';
import UserRepo from '../models/UserRepository.js';
import db from '../db/connection.js';

const router = Router();

async function safeRun(sql, params = []) {
  try {
    await db.run(sql, params);
  } catch (e) {
    console.warn(`[SAFE DELETE WARN] ${sql}:`, e.message);
  }
}

// Permanent complete account deletion endpoint
router.post('/delete', authenticateAccess, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await UserRepo.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found.' });
    }

    await revokeAllUserTokens(userId);

    const userPets = await db.all('SELECT id FROM pets WHERE user_id = ?', [userId]) || [];
    const petIds = userPets.map(p => p.id);

    await safeRun('DELETE FROM trusted_devices WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM notification_preferences WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM notifications WHERE user_id = ?', [userId]);

    await safeRun('DELETE FROM community_members WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM community_messages WHERE sender_id = ?', [userId]);
    await safeRun('DELETE FROM community_photos WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM community_join_requests WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM community_announcements WHERE sender_id = ?', [userId]);

    await safeRun('DELETE FROM likes WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM comments WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM post_reports WHERE user_id = ?', [userId]);

    if (petIds.length > 0) {
      const placeholders = petIds.map(() => '?').join(',');
      await safeRun(`DELETE FROM swipes WHERE from_pet_id IN (${placeholders}) OR to_pet_id IN (${placeholders})`, [...petIds, ...petIds]);
      await safeRun(`DELETE FROM matches WHERE pet1_id IN (${placeholders}) OR pet2_id IN (${placeholders})`, [...petIds, ...petIds]);
      await safeRun(`DELETE FROM calls WHERE caller_pet_id IN (${placeholders}) OR receiver_pet_id IN (${placeholders})`, [...petIds, ...petIds]);
      await safeRun(`DELETE FROM posts WHERE pet_id IN (${placeholders})`, petIds);
    }
    await safeRun('DELETE FROM messages WHERE sender_id = ?', [userId]);

    await safeRun('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?', [userId, userId]);

    await safeRun('DELETE FROM pets WHERE user_id = ?', [userId]);
    await safeRun('DELETE FROM users WHERE id = ?', [userId]);

    console.log(`[ACCOUNT DELETED SUCCESS]: User ID ${userId} deleted permanently.`);
    return res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('[DELETE ACCOUNT ERROR]:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to delete account.' });
  }
});

export default router;