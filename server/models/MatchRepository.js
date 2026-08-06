import BaseRepository from './BaseRepository.js';
import db from '../db/connection.js';

class MatchRepository extends BaseRepository {
  constructor() { super('matches'); }

  async swipe(fromPetId, toPetId, action) {
    const existing = await db.get('SELECT id FROM swipes WHERE from_pet_id = ? AND to_pet_id = ?', [fromPetId, toPetId]);
    if (existing) {
      await db.run('UPDATE swipes SET action = ?, created_at = CURRENT_TIMESTAMP WHERE from_pet_id = ? AND to_pet_id = ?', [action, fromPetId, toPetId]);
    } else {
      await db.run('INSERT INTO swipes (from_pet_id, to_pet_id, action) VALUES (?, ?, ?)', [fromPetId, toPetId, action]);
    }
    // Check for mutual like
    if (action === 'like' || action === 'superlike') {
      const mutual = await db.get(
        "SELECT id FROM swipes WHERE from_pet_id = ? AND to_pet_id = ? AND action IN ('like', 'superlike')",
        [toPetId, fromPetId]
      );
      if (mutual) {
        const existingMatch = await db.get(
          'SELECT id FROM matches WHERE (pet1_id = ? AND pet2_id = ?) OR (pet1_id = ? AND pet2_id = ?)',
          [fromPetId, toPetId, toPetId, fromPetId]
        );
        if (!existingMatch) {
          const matchResult = await db.run('INSERT INTO matches (pet1_id, pet2_id) VALUES (?, ?) RETURNING id', [fromPetId, toPetId]);
          const matchId = matchResult.rows[0].id;
          await db.run('INSERT INTO conversations (match_id) VALUES (?)', [matchId]);
          return { matched: true, matchId };
        }
      }
    }
    return { matched: false };
  }

  /**
   * Meet Feed Visibility Exclusions:
   * 1. Own Pet ID.
   * 2. Permanent Exclusion: Mutual Matches (pet1_id = petId OR pet2_id = petId).
   * 3. 20-Day Bidirectional Exclusion: Rejections (action = 'decline'/'pass'/'reject') where
   *    either user rejected the other within the last 20 days.
   * 4. Single-Sided Sent Likes / Superlikes by petId (so pet doesn't see profiles it already liked).
   */
  async getExcludedMeetPetIds(petId) {
    const excluded = new Set();
    excluded.add(petId);

    // 1. Permanent Exclusion: Mutual Matches
    const matches = await db.all(
      'SELECT pet1_id, pet2_id FROM matches WHERE pet1_id = ? OR pet2_id = ?',
      [petId, petId]
    );
    matches.forEach(m => {
      excluded.add(m.pet1_id === petId ? m.pet2_id : m.pet1_id);
    });

    // 2. 20-Day Bidirectional Exclusion: Rejections within last 20 days
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    const rejections = await db.all(
      `SELECT from_pet_id, to_pet_id, created_at FROM swipes 
       WHERE action IN ('decline', 'pass', 'reject') 
         AND (from_pet_id = ? OR to_pet_id = ?)`,
      [petId, petId]
    );

    rejections.forEach(r => {
      let isWithin20Days = true;
      if (r.created_at) {
        const rawStr = String(r.created_at).trim();
        const isoStr = rawStr.includes('T') ? rawStr : rawStr.replace(' ', 'T') + (rawStr.endsWith('Z') ? '' : 'Z');
        const createdAtMs = new Date(isoStr).getTime();
        if (!isNaN(createdAtMs)) {
          isWithin20Days = (nowMs - createdAtMs) <= twentyDaysMs;
        }
      }
      if (isWithin20Days) {
        const otherId = r.from_pet_id === petId ? r.to_pet_id : r.from_pet_id;
        excluded.add(otherId);
      }
    });

    // 3. Single-Sided Sent Likes / Superlikes by this pet
    const sentLikes = await db.all(
      "SELECT to_pet_id FROM swipes WHERE from_pet_id = ? AND action IN ('like', 'superlike')",
      [petId]
    );
    sentLikes.forEach(l => excluded.add(l.to_pet_id));

    return Array.from(excluded);
  }

  async getSwipedIds(petId) {
    return this.getExcludedMeetPetIds(petId);
  }

  /**
   * Undo Like: the pending -> committed flow used only by Meet's swipe-right.
   * Unlike swipe(), a like/superlike here is stored with status='pending' and
   * does NOT check for a mutual match yet -- that only happens in commitSwipe(),
   * once the 5s undo window has elapsed. This is what guarantees a match is never
   * created off a like that gets undone (see commitSwipe below).
   */
  async createPendingLike(fromPetId, toPetId) {
    const existing = await db.get('SELECT id FROM swipes WHERE from_pet_id = ? AND to_pet_id = ?', [fromPetId, toPetId]);
    if (existing) {
      await db.run(
        "UPDATE swipes SET action = 'like', status = 'pending', notification_id = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?",
        [existing.id]
      );
      return { id: existing.id };
    }
    const result = await db.run(
      "INSERT INTO swipes (from_pet_id, to_pet_id, action, status) VALUES (?, ?, 'like', 'pending') RETURNING id",
      [fromPetId, toPetId]
    );
    return { id: result.rows[0].id };
  }

  async attachNotificationId(swipeId, notificationId) {
    await db.run('UPDATE swipes SET notification_id = ? WHERE id = ?', [notificationId, swipeId]);
  }

  // Fires once the undo window has elapsed. Flips the swipe to committed, then
  // -- and only then -- checks for a mutual COMMITTED like on the other side.
  // If the swipe was undone (row deleted) or already committed, this is a no-op.
  async commitSwipe(swipeId) {
    const swipe = await db.get("SELECT * FROM swipes WHERE id = ? AND status = 'pending'", [swipeId]);
    if (!swipe) return { matched: false };

    await db.run("UPDATE swipes SET status = 'committed' WHERE id = ?", [swipeId]);

    const mutual = await db.get(
      "SELECT id FROM swipes WHERE from_pet_id = ? AND to_pet_id = ? AND action IN ('like', 'superlike') AND status = 'committed'",
      [swipe.to_pet_id, swipe.from_pet_id]
    );
    if (!mutual) return { matched: false };

    const existingMatch = await db.get(
      'SELECT id FROM matches WHERE (pet1_id = ? AND pet2_id = ?) OR (pet1_id = ? AND pet2_id = ?)',
      [swipe.from_pet_id, swipe.to_pet_id, swipe.to_pet_id, swipe.from_pet_id]
    );
    if (existingMatch) return { matched: false };

    const matchResult = await db.run('INSERT INTO matches (pet1_id, pet2_id) VALUES (?, ?) RETURNING id', [swipe.from_pet_id, swipe.to_pet_id]);
    const matchId = matchResult.rows[0].id;
    await db.run('INSERT INTO conversations (match_id) VALUES (?)', [matchId]);

    return { matched: true, matchId, fromPetId: swipe.from_pet_id, toPetId: swipe.to_pet_id };
  }

  // Only deletes a swipe that's still pending -- if the undo window already
  // closed (and commitSwipe already ran), this returns null and the like stands.
  async undoLike(fromPetId, toPetId) {
    const result = await db.run(
      "DELETE FROM swipes WHERE from_pet_id = ? AND to_pet_id = ? AND action IN ('like', 'superlike') AND status = 'pending' RETURNING id, notification_id",
      [fromPetId, toPetId]
    );
    if (!result.rows.length) return null;
    return { swipeId: result.rows[0].id, notificationId: result.rows[0].notification_id };
  }

  async getMatches(petId, page = 1, limit = 30) {
    const offset = (page - 1) * limit;
    const matches = await db.all(`
      SELECT m.*,
        CASE WHEN m.pet1_id = ? THEN p2.id ELSE p1.id END as matched_pet_id,
        CASE WHEN m.pet1_id = ? THEN p2.name ELSE p1.name END as matched_pet_name,
        CASE WHEN m.pet1_id = ? THEN p2.avatar_url ELSE p1.avatar_url END as matched_pet_avatar,
        CASE WHEN m.pet1_id = ? THEN p2.pet_username ELSE p1.pet_username END as matched_pet_username,
        CASE WHEN m.pet1_id = ? THEN p2.breed_name ELSE p1.breed_name END as matched_pet_breed,
        c.id as conversation_id
      FROM matches m
      JOIN pets p1 ON m.pet1_id = p1.id
      JOIN pets p2 ON m.pet2_id = p2.id
      LEFT JOIN conversations c ON c.match_id = m.id
      WHERE m.pet1_id = ? OR m.pet2_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [petId, petId, petId, petId, petId, petId, petId, limit, offset]);
    const totalRow = await db.get('SELECT COUNT(*) as count FROM matches WHERE pet1_id = ? OR pet2_id = ?', [petId, petId]);
    const total = totalRow ? Number(totalRow.count) : 0;
    return { matches, total, page, hasMore: offset + limit < total };
  }

  /**
   * Meet Activity Lists:
   * 1. Requested: Outgoing requests sent by petId, awaiting target pet response (not accepted, not declined).
   * 2. Pending: Incoming requests sent to petId, awaiting petId response (not swiped back, not matched).
   * 3. Accepted: Mutual matches.
   */
  async getMeetActivityLists(petId) {
    // 1. Requested (outgoing pending)
    const requested = await db.all(`
      SELECT p.id as pet_id, p.name, p.pet_username, p.avatar_url, p.breed_name, p.gender, p.age, s.created_at
      FROM swipes s
      JOIN pets p ON s.to_pet_id = p.id
      WHERE s.from_pet_id = ? 
        AND s.action IN ('like', 'superlike')
        AND NOT EXISTS (
          SELECT 1 FROM swipes s2 
          WHERE s2.from_pet_id = p.id AND s2.to_pet_id = ? AND s2.action IN ('decline', 'pass', 'reject')
        )
        AND NOT EXISTS (
          SELECT 1 FROM matches m 
          WHERE (m.pet1_id = ? AND m.pet2_id = p.id) OR (m.pet1_id = p.id AND m.pet2_id = ?)
        )
      ORDER BY s.created_at DESC
    `, [petId, petId, petId, petId]);

    // 2. Pending (incoming pending)
    const pending = await db.all(`
      SELECT p.id as pet_id, p.name, p.pet_username, p.avatar_url, p.breed_name, p.gender, p.age, s.created_at
      FROM swipes s
      JOIN pets p ON s.from_pet_id = p.id
      WHERE s.to_pet_id = ? 
        AND s.action IN ('like', 'superlike')
        AND NOT EXISTS (
          SELECT 1 FROM swipes s2 
          WHERE s2.from_pet_id = ? AND s2.to_pet_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM matches m 
          WHERE (m.pet1_id = ? AND m.pet2_id = p.id) OR (m.pet1_id = p.id AND m.pet2_id = ?)
        )
      ORDER BY s.created_at DESC
    `, [petId, petId, petId, petId]);

    // 3. Accepted (mutual matches)
    const { matches: accepted } = await this.getMatches(petId, 1, 100);

    return { requested, pending, accepted };
  }
}

export default new MatchRepository();