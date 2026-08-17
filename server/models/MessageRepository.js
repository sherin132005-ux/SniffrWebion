import BaseRepository from './BaseRepository.js';
import db from '../db/connection.js';
import PetRepo from './PetRepository.js';
import { hasCurrentAccess } from '../services/subscriptionService.js';

class MessageRepository extends BaseRepository {
  constructor() { super('messages'); }

  async getConversations(userId) {
    const activePet = await PetRepo.getActivePet(userId);
    if (!activePet) return [];
    const conversations = await db.all(`
      SELECT c.*, m.pet1_id, m.pet2_id,
        CASE WHEN m.pet1_id = ? THEN p2.name ELSE p1.name END as partner_name,
        CASE WHEN m.pet1_id = ? THEN p2.avatar_url ELSE p1.avatar_url END as partner_avatar,
        CASE WHEN m.pet1_id = ? THEN p2.id ELSE p1.id END as partner_pet_id,
        CASE WHEN m.pet1_id = ? THEN p2.pet_username ELSE p1.pet_username END as partner_username,
        CASE WHEN m.pet1_id = ? THEN p2.user_id ELSE p1.user_id END as partner_user_id,
        CASE WHEN m.pet1_id = ? THEN (SELECT last_active_at FROM users WHERE id = p2.user_id) ELSE (SELECT last_active_at FROM users WHERE id = p1.user_id) END as partner_last_active_at,
        CASE WHEN m.pet1_id = ? THEN (SELECT subscription_status FROM users WHERE id = p2.user_id) ELSE (SELECT subscription_status FROM users WHERE id = p1.user_id) END as partner_subscription_status,
        CASE WHEN m.pet1_id = ? THEN (SELECT premium_badge_enabled FROM users WHERE id = p2.user_id) ELSE (SELECT premium_badge_enabled FROM users WHERE id = p1.user_id) END as partner_premium_badge_enabled,
        CASE WHEN m.pet1_id = ? THEN (SELECT plan_expiry_date FROM users WHERE id = p2.user_id) ELSE (SELECT plan_expiry_date FROM users WHERE id = p1.user_id) END as partner_plan_expiry_date,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND status != 'seen') as unread_count
      FROM conversations c
      JOIN matches m ON c.match_id = m.id
      JOIN pets p1 ON m.pet1_id = p1.id
      JOIN pets p2 ON m.pet2_id = p2.id
      WHERE m.pet1_id = ? OR m.pet2_id = ?
      ORDER BY last_message_at DESC
    `, [activePet.id, activePet.id, activePet.id, activePet.id, activePet.id, activePet.id, activePet.id, activePet.id, activePet.id, userId, activePet.id, activePet.id]);

    conversations.forEach(c => {
      c.is_premium = !!(hasCurrentAccess({
        subscription_status: c.partner_subscription_status,
        plan_expiry_date: c.partner_plan_expiry_date,
      }) && c.partner_premium_badge_enabled);
    });
    return conversations;
  }

  async getMessages(conversationId, page = 1, limit = 30) {
    const offset = (page - 1) * limit;
    const rows = await db.all(`
      SELECT msg.*, u.username as sender_username,
        (COALESCE((SELECT avatar_url FROM pets WHERE id = u.active_pet_id), (SELECT avatar_url FROM pets WHERE user_id = u.id ORDER BY id ASC LIMIT 1))) as sender_avatar,
        reply.content as reply_content,
        reply.sender_id as reply_sender_id,
        reply.message_type as reply_message_type,
        (SELECT username FROM users WHERE id = reply.sender_id) as reply_sender_username,
        (
          SELECT COALESCE(json_object_agg(mr.reaction, mr.cnt), '{}'::json)
          FROM (
            SELECT reaction, COUNT(*)::int as cnt
            FROM message_reactions
            WHERE message_id = msg.id
            GROUP BY reaction
          ) mr
        ) as reactions
      FROM messages msg
      JOIN users u ON msg.sender_id = u.id
      LEFT JOIN messages reply ON msg.reply_to_id = reply.id
      WHERE msg.conversation_id = ?
      ORDER BY msg.created_at DESC
      LIMIT ? OFFSET ?
    `, [conversationId, limit, offset]);
    return rows.reverse();
  }

  async sendMessage(conversationId, senderId, content, mediaUrl = null, messageType = 'text', replyToId = null) {
    const result = await db.run(
      'INSERT INTO messages (conversation_id, sender_id, content, media_url, message_type, status, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [conversationId, senderId, content, mediaUrl, messageType, 'sent', replyToId]
    );
    const newId = result.rows[0].id;
    return db.get(`
      SELECT msg.*, u.username as sender_username,
        (COALESCE((SELECT avatar_url FROM pets WHERE id = u.active_pet_id), (SELECT avatar_url FROM pets WHERE user_id = u.id ORDER BY id ASC LIMIT 1))) as sender_avatar,
        reply.content as reply_content,
        reply.sender_id as reply_sender_id,
        reply.message_type as reply_message_type,
        (SELECT username FROM users WHERE id = reply.sender_id) as reply_sender_username
      FROM messages msg
      JOIN users u ON msg.sender_id = u.id
      LEFT JOIN messages reply ON msg.reply_to_id = reply.id
      WHERE msg.id = ?
    `, [newId]);
  }

  async markDelivered(messageId) {
    await db.run("UPDATE messages SET status = 'delivered', delivered_at = NOW() WHERE id = ? AND status = 'sent'", [messageId]);
  }

  async markSeen(conversationId, userId) {
    await db.run(`UPDATE messages SET status = 'seen', seen_at = NOW()
      WHERE conversation_id = ? AND sender_id != ? AND status != 'seen'`, [conversationId, userId]);
  }

  async getUndelivered(userId) {
  return db.all(`
    SELECT msg.*, c.id AS conversation_id
    FROM messages msg
    JOIN conversations c
      ON msg.conversation_id = c.id
    JOIN matches m
      ON c.match_id = m.id
    WHERE msg.status = 'sent'
      AND msg.sender_id != ?
      AND (
        m.pet1_id IN (
          SELECT id FROM pets WHERE user_id = ?
        )
        OR
        m.pet2_id IN (
          SELECT id FROM pets WHERE user_id = ?
        )
      )
  `, [userId, userId, userId]);
}

  async canAccessConversation(conversationId, userId) {
    return db.get(`
      SELECT c.id FROM conversations c
      JOIN matches m ON c.match_id = m.id
      WHERE c.id = ?
        AND (m.pet1_id IN (SELECT id FROM pets WHERE user_id = ?)
          OR m.pet2_id IN (SELECT id FROM pets WHERE user_id = ?))
    `, [conversationId, userId, userId]);
  }

  // Resolves the OTHER participant's user_id for a conversation the caller
  // is already confirmed to be in -- used to enforce block checks on
  // existing conversations, not just at conversation-creation time.
  async getOtherParticipantUserId(conversationId, userId) {
    const row = await db.get(`
      SELECT CASE WHEN p1.user_id = ? THEN p2.user_id ELSE p1.user_id END as other_user_id
      FROM conversations c
      JOIN matches m ON c.match_id = m.id
      JOIN pets p1 ON m.pet1_id = p1.id
      JOIN pets p2 ON m.pet2_id = p2.id
      WHERE c.id = ?
    `, [userId, conversationId]);
    return row ? row.other_user_id : null;
  }

  async findOrCreateConversation(petId1, petId2) {
    let match = await db.get('SELECT id FROM matches WHERE (pet1_id = ? AND pet2_id = ?) OR (pet1_id = ? AND pet2_id = ?)', [petId1, petId2, petId2, petId1]);

    if (!match) {
      // source='chat' distinguishes this incidental conversation-linkage row
      // from a real Meet match (source='meet', created by MatchRepository) --
      // Meet's "Accepted" list and getExcludedMeetPetIds's permanent-match
      // exclusion both filter on source='meet' so a pet you only ever
      // messaged directly is never mistaken for a Meet match.
      const matchResult = await db.run("INSERT INTO matches (pet1_id, pet2_id, source) VALUES (?, ?, 'chat') RETURNING id", [petId1, petId2]);
      match = { id: matchResult.rows[0].id };
    }

    let conversation = await db.get('SELECT * FROM conversations WHERE match_id = ?', [match.id]);

    if (!conversation) {
      const convResult = await db.run('INSERT INTO conversations (match_id) VALUES (?) RETURNING id', [match.id]);
      conversation = await db.get('SELECT * FROM conversations WHERE id = ?', [convResult.rows[0].id]);
    }

    return conversation;
  }

  async updateMessageContent(messageId, newContent) {
    await db.run('UPDATE messages SET content = ? WHERE id = ?', [newContent, messageId]);
    return db.get(`
      SELECT msg.*, u.username as sender_username,
        (COALESCE((SELECT avatar_url FROM pets WHERE id = u.active_pet_id), (SELECT avatar_url FROM pets WHERE user_id = u.id ORDER BY id ASC LIMIT 1))) as sender_avatar
      FROM messages msg JOIN users u ON msg.sender_id = u.id WHERE msg.id = ?
    `, [messageId]);
  }

  async fetchBackMessage(messageId, userId) {
    const msg = await db.get('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!msg || msg.sender_id !== userId) return null;

    await db.run("UPDATE messages SET content = '🐾 This message was fetched back.', message_type = 'system', media_url = NULL WHERE id = ?", [messageId]);
    return db.get(`
      SELECT msg.*, u.username as sender_username,
        (COALESCE((SELECT avatar_url FROM pets WHERE id = u.active_pet_id), (SELECT avatar_url FROM pets WHERE user_id = u.id ORDER BY id ASC LIMIT 1))) as sender_avatar
      FROM messages msg JOIN users u ON msg.sender_id = u.id WHERE msg.id = ?
    `, [messageId]);
  }

  async getMessageById(messageId) {
  return db.get(`
    SELECT
      msg.*,
      u.username AS sender_username,
      (
        COALESCE(
          (SELECT avatar_url
           FROM pets
           WHERE id = u.active_pet_id),
          (SELECT avatar_url
           FROM pets
           WHERE user_id = u.id
           ORDER BY id ASC
           LIMIT 1)
        )
      ) AS sender_avatar,

      reply.content AS reply_content,
      reply.sender_id AS reply_sender_id,
      reply.message_type AS reply_message_type,
      (
        SELECT username
        FROM users
        WHERE id = reply.sender_id
      ) AS reply_sender_username

    FROM messages msg
    JOIN users u
      ON msg.sender_id = u.id

    LEFT JOIN messages reply
      ON msg.reply_to_id = reply.id

    WHERE msg.id = ?
  `, [messageId]);
}

async getSeenMessages(conversationId) {
  return db.all(`
    SELECT
      msg.*,
      u.username AS sender_username,
      (
        COALESCE(
          (SELECT avatar_url
           FROM pets
           WHERE id = u.active_pet_id),
          (SELECT avatar_url
           FROM pets
           WHERE user_id = u.id
           ORDER BY id ASC
           LIMIT 1)
        )
      ) AS sender_avatar,

      reply.content AS reply_content,
      reply.sender_id AS reply_sender_id,
      reply.message_type AS reply_message_type,
      (
        SELECT username
        FROM users
        WHERE id = reply.sender_id
      ) AS reply_sender_username

    FROM messages msg
    JOIN users u
      ON msg.sender_id = u.id

    LEFT JOIN messages reply
      ON msg.reply_to_id = reply.id

    WHERE msg.conversation_id = ?
      AND msg.status = 'seen'
  `, [conversationId]);
}
  async deleteEmptyConversation(conversationId, userId) {
    const access = await this.canAccessConversation(conversationId, userId);
    if (!access) return false;

    const messageCount = await db.get('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?', [conversationId]);
    if (messageCount && Number(messageCount.cnt) === 0) {
      await db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
      return true;
    }
    return false;
  }
}

export default new MessageRepository();