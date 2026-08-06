import db from '../db/connection.js';
import BaseRepository from './BaseRepository.js';
import { hasCurrentAccess } from '../services/subscriptionService.js';

class CommunityRepository extends BaseRepository {
  constructor() {
    super('communities');
  }

  async getRecommendedForPet(pet) {
    const list = await db.all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND joined_at >= NOW() - INTERVAL '7 days') as recent_growth
      FROM communities c
      WHERE c.is_private = 0
    `);

    if (list.length === 0) return [];

    const scored = list.map(comm => {
      let score = 0;
      score += Math.min(100, comm.member_count || 0);
      score += Number(comm.recent_growth || 0) * 5;

      const ageDays = (Date.now() - new Date(comm.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays <= 15) {
        score += 50;
      }

      if (pet) {
        if (pet.type && comm.pet_type && (comm.pet_type.toLowerCase() === pet.type.toLowerCase() || comm.pet_type.toLowerCase() === 'all')) {
          score += 20;
        }
        if (pet.breed_name && comm.breed && comm.breed.toLowerCase() === pet.breed_name.toLowerCase()) {
          score += 30;
        }
        if (pet.city && comm.city && comm.city.toLowerCase() === pet.city.toLowerCase()) {
          score += 25;
        }
      }

      return { ...comm, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const rotationHours = 6;
    const intervalIndex = Math.floor(Date.now() / (1000 * 60 * 60 * rotationHours));
    const offset = intervalIndex % scored.length;

    const rotated = [...scored.slice(offset), ...scored.slice(0, offset)];

    return rotated;
  }

  async search({ q = '', category, breed, pet_type, city, tags }) {
    let sql = 'SELECT * FROM communities WHERE 1=1';
    const params = [];

    if (q) {
      sql += ' AND (name LIKE ? OR description LIKE ? OR city LIKE ? OR breed LIKE ? OR tags LIKE ?)';
      const term = `%${q}%`;
      params.push(term, term, term, term, term);
    }
    if (category && category !== 'All') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (breed) {
      sql += ' AND breed = ?';
      params.push(breed);
    }
    if (pet_type && pet_type !== 'All') {
      sql += " AND (pet_type = ? OR pet_type = 'All')";
      params.push(pet_type);
    }
    if (city) {
      sql += ' AND city LIKE ?';
      params.push(`%${city}%`);
    }
    if (tags) {
      sql += ' AND tags LIKE ?';
      params.push(`%${tags}%`);
    }

    sql += ' ORDER BY member_count DESC';
    return db.all(sql, params);
  }

  async getDetailsWithStatus(communityId, userId) {
    const community = await this.findById(communityId);
    if (!community) return null;

    const membership = await db.get(
      'SELECT role, verified_badge, cleared_at, is_hidden FROM community_members WHERE community_id = ? AND user_id = ?',
      [communityId, userId]
    );

    const joinRequest = !membership ? await db.get(
      'SELECT status FROM community_join_requests WHERE community_id = ? AND user_id = ?',
      [communityId, userId]
    ) : null;

    let joinStatus = 'Join';
    if (membership) joinStatus = 'Joined';
    else if (joinRequest?.status === 'pending') joinStatus = 'Requested';
    else if (community.is_private) joinStatus = 'Invite Only';

    let isHiddenFromList = false;
    if (membership && membership.is_hidden === 1 && membership.cleared_at) {
      const hasNewMsg = await db.get(
        `SELECT 1 FROM community_messages WHERE community_id = ? AND created_at > ? LIMIT 1`,
        [communityId, membership.cleared_at]
      );
      const hasNewAnn = await db.get(
        `SELECT 1 FROM community_announcements WHERE community_id = ? AND created_at > ? LIMIT 1`,
        [communityId, membership.cleared_at]
      );

      if (!hasNewMsg && !hasNewAnn) {
        isHiddenFromList = true;
      } else {
        await db.run(
          `UPDATE community_members SET is_hidden = 0 WHERE community_id = ? AND user_id = ?`,
          [communityId, userId]
        );
      }
    }

    const activeRow = await db.get(
      `SELECT COUNT(*) as count FROM community_members WHERE community_id = ? AND last_active_at >= NOW() - INTERVAL '1 day'`,
      [communityId]
    );
    const activeMembersCount = activeRow?.count ? Number(activeRow.count) : Math.max(1, Math.floor(community.member_count * 0.4));

    return {
      ...community,
      joinStatus,
      userRole: membership?.role || null,
      userBadge: membership?.verified_badge || null,
      activeMembersCount,
      clearedAt: membership?.cleared_at || null,
      isHiddenFromList
    };
  }

  // Full, unpaginated member list -- used internally wherever EVERY member
  // needs to be reached (e.g. announcement fan-out notifications). Do not
  // use this for a client-facing list endpoint; see getMembersPaginated.
  async getMembers(communityId) {
    const members = await db.all(
      `SELECT cm.*, u.username, u.full_name, u.email,
              u.subscription_status, u.premium_badge_enabled, u.plan_expiry_date,
              p.name as pet_name, p.avatar_url as pet_avatar
       FROM community_members cm
       JOIN users u ON cm.user_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cm.community_id = ?
       ORDER BY
         CASE cm.role
           WHEN 'Owner' THEN 1
           WHEN 'Admin' THEN 2
           WHEN 'Moderator' THEN 3
           ELSE 4
         END, cm.joined_at ASC`,
      [communityId]
    );
    members.forEach(m => { m.is_premium = !!(hasCurrentAccess(m) && m.premium_badge_enabled); });
    return members;
  }

  async getMembersPaginated(communityId, page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const members = await db.all(
      `SELECT cm.*, u.username, u.full_name, u.email,
              u.subscription_status, u.premium_badge_enabled, u.plan_expiry_date,
              p.name as pet_name, p.avatar_url as pet_avatar
       FROM community_members cm
       JOIN users u ON cm.user_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cm.community_id = ?
       ORDER BY
         CASE cm.role
           WHEN 'Owner' THEN 1
           WHEN 'Admin' THEN 2
           WHEN 'Moderator' THEN 3
           ELSE 4
         END, cm.joined_at ASC
       LIMIT ? OFFSET ?`,
      [communityId, limit, offset]
    );
    members.forEach(m => { m.is_premium = !!(hasCurrentAccess(m) && m.premium_badge_enabled); });
    const totalRow = await db.get('SELECT COUNT(*) as count FROM community_members WHERE community_id = ?', [communityId]);
    const total = totalRow ? Number(totalRow.count) : 0;
    return { members, total, page, hasMore: offset + limit < total };
  }

  async getAnnouncements(communityId) {
    return db.all(
      `SELECT ca.*, u.username, u.full_name, p.avatar_url as sender_avatar
       FROM community_announcements ca
       JOIN users u ON ca.sender_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE ca.community_id = ?
       ORDER BY ca.created_at DESC
       LIMIT 3`,
      [communityId]
    );
  }

  async getMessages(communityId, userId = null, limit = 50) {
    let clearedAt = null;
    if (userId) {
      const mem = await db.get(
        'SELECT cleared_at FROM community_members WHERE community_id = ? AND user_id = ?',
        [communityId, userId]
      );
      clearedAt = mem?.cleared_at || null;
    }

    if (clearedAt) {
      return db.all(
        `SELECT cm.*, u.username, u.full_name, p.name as pet_name, p.avatar_url as sender_avatar
         FROM community_messages cm
         JOIN users u ON cm.sender_id = u.id
         LEFT JOIN pets p ON u.id = p.user_id
         WHERE cm.community_id = ? AND cm.created_at > ?
         ORDER BY cm.created_at ASC
         LIMIT ?`,
        [communityId, clearedAt, limit]
      );
    }

    return db.all(
      `SELECT cm.*, u.username, u.full_name, p.name as pet_name, p.avatar_url as sender_avatar
       FROM community_messages cm
       JOIN users u ON cm.sender_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cm.community_id = ?
       ORDER BY cm.created_at ASC
       LIMIT ?`,
      [communityId, limit]
    );
  }

  async deleteGroupForUser(communityId, userId) {
    await db.run(
      `UPDATE community_members 
       SET cleared_at = CURRENT_TIMESTAMP, is_hidden = 1 
       WHERE community_id = ? AND user_id = ?`,
      [communityId, userId]
    );
    return { success: true };
  }

  async getPhotos(communityId) {
    return db.all(
      `SELECT cp.*, u.username, p.avatar_url as sender_avatar
       FROM community_photos cp
       JOIN users u ON cp.user_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cp.community_id = ?
       ORDER BY cp.created_at DESC`,
      [communityId]
    );
  }

  async addPhoto({ community_id, user_id, media_url, caption = '' }) {
    const result = await db.run(
      'INSERT INTO community_photos (community_id, user_id, media_url, caption) VALUES (?, ?, ?, ?) RETURNING id',
      [community_id, user_id, media_url, caption]
    );
    return db.get(
      `SELECT cp.*, u.username, p.avatar_url as sender_avatar
       FROM community_photos cp
       JOIN users u ON cp.user_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cp.id = ?`,
      [result.rows[0].id]
    );
  }

  async getEvents(communityId) {
    return db.all(
      `SELECT ce.*, u.username as creator_name
       FROM community_events ce
       LEFT JOIN users u ON ce.created_by = u.id
       WHERE ce.community_id = ?
       ORDER BY ce.event_date ASC`,
      [communityId]
    );
  }

  async getPolls(communityId) {
    const rows = await db.all(
      `SELECT cp.*, u.username as creator_name
       FROM community_polls cp
       LEFT JOIN users u ON cp.created_by = u.id
       WHERE cp.community_id = ?
       ORDER BY cp.created_at DESC`,
      [communityId]
    );
    return rows.map(poll => ({
      ...poll,
      options: JSON.parse(poll.options_json || '[]'),
      votes: JSON.parse(poll.votes_json || '{}')
    }));
  }

  async join(communityId, userId, role = 'Member') {
    await db.run(
      'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (community_id, user_id) DO NOTHING',
      [communityId, userId, role]
    );
    await db.run(
      'UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ?) WHERE id = ?',
      [communityId, communityId]
    );
    return this.getDetailsWithStatus(communityId, userId);
  }

  async leave(communityId, userId) {
    await db.run('DELETE FROM community_members WHERE community_id = ? AND user_id = ?', [communityId, userId]);
    await db.run(
      'UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ?) WHERE id = ?',
      [communityId, communityId]
    );
    return { success: true };
  }

  async addMessage({ community_id, sender_id, content, media_url = null, message_type = 'text' }) {
    const result = await db.run(
      'INSERT INTO community_messages (community_id, sender_id, content, media_url, message_type) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [community_id, sender_id, content, media_url, message_type]
    );
    await db.run('UPDATE community_members SET is_hidden = 0 WHERE community_id = ?', [community_id]);

    return db.get(
      `SELECT cm.*, u.username, u.full_name, p.name as pet_name, p.avatar_url as sender_avatar
       FROM community_messages cm
       JOIN users u ON cm.sender_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE cm.id = ?`,
      [result.rows[0].id]
    );
  }

  async addAnnouncement({ community_id, sender_id, title, content, latitude = null, longitude = null, is_event = 0 }) {
    const result = await db.run(
      'INSERT INTO community_announcements (community_id, sender_id, title, content, latitude, longitude, is_event) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [community_id, sender_id, title, content, latitude, longitude, is_event]
    );
    await db.run('UPDATE community_members SET is_hidden = 0 WHERE community_id = ?', [community_id]);

    return db.get(
      `SELECT ca.*, u.username, u.full_name, p.avatar_url as sender_avatar
       FROM community_announcements ca
       JOIN users u ON ca.sender_id = u.id
       LEFT JOIN pets p ON u.id = p.user_id
       WHERE ca.id = ?`,
      [result.rows[0].id]
    );
  }

  async getNearbyNonMembers(communityId, lat, lng, radiusKm = 20) {
    // All users with a saved pet location, excluding current members of this community
    const rows = await db.all(
      `SELECT DISTINCT u.id as user_id, p.latitude, p.longitude
       FROM users u
       JOIN pets p ON p.user_id = u.id
       WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         AND u.id NOT IN (SELECT user_id FROM community_members WHERE community_id = ?)`,
      [communityId]
    );

    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const seen = new Set();
    const nearby = [];
    for (const r of rows) {
      if (seen.has(r.user_id)) continue;
      const dLat = toRad(r.latitude - lat);
      const dLon = toRad(r.longitude - lng);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(r.latitude)) * Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.asin(Math.sqrt(a));
      if (dist <= radiusKm) {
        seen.add(r.user_id);
        nearby.push({ user_id: r.user_id, distance: dist });
      }
    }
    return nearby;
  }

  async createPoll({ community_id, question, options, created_by }) {
    const result = await db.run(
      'INSERT INTO community_polls (community_id, question, options_json, votes_json, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [community_id, question, JSON.stringify(options), JSON.stringify({}), created_by]
    );
    const polls = await this.getPolls(community_id);
    return polls.find(p => p.id === result.rows[0].id);
  }

  async votePoll(pollId, userId, optionIndex) {
    const poll = await db.get('SELECT * FROM community_polls WHERE id = ?', [pollId]);
    if (!poll) throw new Error('Poll not found');
    const votes = JSON.parse(poll.votes_json || '{}');

    Object.keys(votes).forEach(idx => {
      votes[idx] = (votes[idx] || []).filter(id => id !== userId);
    });

    if (!votes[String(optionIndex)]) votes[String(optionIndex)] = [];
    votes[String(optionIndex)].push(userId);

    await db.run('UPDATE community_polls SET votes_json = ? WHERE id = ?', [JSON.stringify(votes), pollId]);
    return {
      ...poll,
      options: JSON.parse(poll.options_json || '[]'),
      votes
    };
  }
}

export default new CommunityRepository();