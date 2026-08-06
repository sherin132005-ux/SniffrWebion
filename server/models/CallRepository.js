import BaseRepository from './BaseRepository.js';
import db from '../db/connection.js';

class CallRepository extends BaseRepository {
  constructor() { super('calls'); }

  /**
   * Get call history for a pet, with direction resolved per-pet.
   * direction: 'outgoing' if caller, 'incoming' if receiver
   */
  async getHistory(petId) {
    const rows = await db.all(`
      SELECT c.*,
        p1.name as caller_name, p1.avatar_url as caller_avatar,
        p2.name as receiver_name, p2.avatar_url as receiver_avatar
      FROM calls c
      JOIN pets p1 ON c.caller_pet_id = p1.id
      JOIN pets p2 ON c.receiver_pet_id = p2.id
      WHERE c.caller_pet_id = ? OR c.receiver_pet_id = ?
      ORDER BY c.created_at DESC
      LIMIT 100
    `, [petId, petId]);

    return rows.map(row => ({
      ...row,
      direction: row.caller_pet_id === petId ? 'outgoing' : 'incoming',
      // partner is the other party from this pet's perspective
      partner_name: row.caller_pet_id === petId ? row.receiver_name : row.caller_name,
      partner_avatar: row.caller_pet_id === petId ? row.receiver_avatar : row.caller_avatar,
    }));
  }

  async log({ callerPetId, receiverPetId, type, status, duration = 0, declinedBy = null, start_time = null, end_time = null }) {
    const result = await db.run(
      `INSERT INTO calls (caller_pet_id, receiver_pet_id, type, status, duration, declined_by, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [callerPetId, receiverPetId, type, status, duration, declinedBy, start_time, end_time]
    );
    return db.get('SELECT * FROM calls WHERE id = ?', [result.rows[0].id]);
  }
}

export default new CallRepository();