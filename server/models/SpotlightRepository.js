import db from '../db/connection.js';
import config from '../config.js';
import PetRepository from './PetRepository.js';

let cache = {}; // cacheKey -> { data, dateStr }
let previousRanks = {}; // cacheKey -> { petId -> rank }

class SpotlightRepository {
  async getTopPets(area, lat, lng, clientCycleStart = null) {
    // Current date string for daily 00:00 freeze (e.g. "2026-07-24")
    const now = new Date();
    const todayDateStr = clientCycleStart
      ? clientCycleStart.split('T')[0]
      : now.toISOString().split('T')[0];

    const cacheKey = `${area}_${lat || 0}_${lng || 0}_${todayDateStr}`;

    // Return frozen daily leaderboard if calculated for today
    if (cache[cacheKey] && cache[cacheKey].dateStr === todayDateStr) {
      return cache[cacheKey].data;
    }

    let radiusKm;
    switch (area) {
      case 'locality': radiusKm = 50; break;
      case 'city': radiusKm = 150; break;
      case 'country': radiusKm = 1500; break;
      case 'region': radiusKm = 5000; break;
      default: radiusKm = 150;
    }

    // Check and lazily write yesterday's history snapshot
    await this.checkAndSaveHistory(area, lat, lng, todayDateStr);

    // Query all pets with Total Profile Licks & latest lick timestamp for tie-breaking
    // Total Licks = Profile Swipes Received (likes/superlikes) + Post Likes Received
    const allPets = await db.all(`
      SELECT p.*, u.username,
        (
          (SELECT COUNT(*) FROM swipes s WHERE s.to_pet_id = p.id AND s.action IN ('like', 'superlike')) +
          (SELECT COUNT(*) FROM likes l JOIN posts po ON l.post_id = po.id WHERE po.pet_id = p.id AND po.is_flagged = 0)
        ) as total_licks,
        (
          SELECT COALESCE(
            MAX(s.created_at),
            (SELECT MAX(l.created_at) FROM likes l JOIN posts po ON l.post_id = po.id WHERE po.pet_id = p.id)
          ) FROM swipes s WHERE s.to_pet_id = p.id AND s.action IN ('like', 'superlike')
        ) as last_lick_time
      FROM pets p
      JOIN users u ON p.user_id = u.id
      WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        AND p.is_flagged = 0
    `);

    // Filter by distance
    let filtered = lat && lng ? allPets.filter(pet => {
      const dist = haversine(lat, lng, pet.latitude, pet.longitude);
      return dist <= radiusKm;
    }) : allPets;

    // Attach completion stats (attachCompletionStats is async)
    let candidates = await Promise.all(filtered.map(async pet => {
      const petWithStats = await PetRepository.attachCompletionStats(pet);
      return {
        ...petWithStats,
        total_licks: Number(pet.total_licks || 0),
        last_lick_time: pet.last_lick_time || null
      };
    }));

    // ── Deterministic Ranking Logic ─────────────────────────────────
    // 1. Primary: Total Licks descending
    // 2. Tie-break: Earliest last_lick_time (the profile that reached the lick count FIRST ranks higher)
    // 3. Fallback: Earliest pet ID
    candidates.sort((a, b) => {
      if (b.total_licks !== a.total_licks) {
        return b.total_licks - a.total_licks;
      }

      const aTime = a.last_lick_time
        ? new Date(String(a.last_lick_time).replace(' ', 'T') + (String(a.last_lick_time).includes('Z') ? '' : 'Z')).getTime()
        : 0;
      const bTime = b.last_lick_time
        ? new Date(String(b.last_lick_time).replace(' ', 'T') + (String(b.last_lick_time).includes('Z') ? '' : 'Z')).getTime()
        : 0;

      if (aTime !== bTime) {
        if (aTime === 0) return 1;
        if (bTime === 0) return -1;
        return aTime - bTime; // Earliest timestamp first
      }

      return a.id - b.id;
    });

    // Limit to Top 20 highest-ranked profiles (no duplicates)
    const top20Candidates = candidates.slice(0, 20);

    const prevRankMap = previousRanks[cacheKey];
    const newRankMap = {};

    const rankedPets = top20Candidates.map((pet, idx) => {
      const currentRank = idx + 1;
      newRankMap[pet.id] = currentRank;

      let movement = null;
      if (prevRankMap) {
        if (pet.id in prevRankMap) {
          const prevRank = prevRankMap[pet.id];
          if (currentRank < prevRank) {
            movement = { type: 'up', value: prevRank - currentRank };
          } else if (currentRank > prevRank) {
            movement = { type: 'down', value: currentRank - prevRank };
          }
        } else {
          movement = { type: 'new' };
        }
      }

      return {
        ...pet,
        rank: currentRank,
        is_champion: currentRank === 1,
        movement
      };
    });

    previousRanks[cacheKey] = newRankMap;

    // Next reset time at tomorrow 00:00:00
    const nextReset = new Date();
    nextReset.setHours(24, 0, 0, 0);

    const result = {
      top3: rankedPets.slice(0, 3),
      ranks4To10: rankedPets.slice(3, 10),
      ranks11To20: rankedPets.slice(10, 20),
      risingStars: rankedPets.slice(3, 20), // Top 4 to 20 for backward compatibility
      nextResetTime: nextReset.toISOString(),
      lastUpdated: new Date().toISOString()
    };

    // Cache frozen daily leaderboard snapshot
    cache[cacheKey] = { data: result, dateStr: todayDateStr };
    return result;
  }

  async checkAndSaveHistory(area, lat, lng, todayDateStr) {
    try {
      // Calculate yesterday date string
      const todayDate = new Date(todayDateStr);
      const yesterday = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);
      const cycleDateStr = yesterday.toISOString().split('T')[0];

      // Check if history record exists for yesterday
      const existing = await db.get('SELECT id FROM spotlight_history WHERE area = ? AND cycle_date = ?', [area, cycleDateStr]);
      if (existing) return;

      let radiusKm;
      switch (area) {
        case 'locality': radiusKm = 50; break;
        case 'city': radiusKm = 150; break;
        case 'country': radiusKm = 1500; break;
        case 'region': radiusKm = 5000; break;
        default: radiusKm = 150;
      }

      const allPets = await db.all(`
        SELECT p.id, p.latitude, p.longitude,
          (
            (SELECT COUNT(*) FROM swipes s WHERE s.to_pet_id = p.id AND s.action IN ('like', 'superlike')) +
            (SELECT COUNT(*) FROM likes l JOIN posts po ON l.post_id = po.id WHERE po.pet_id = p.id AND po.is_flagged = 0)
          ) as total_licks
        FROM pets p
        WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND p.is_flagged = 0
      `);

      const filtered = lat && lng ? allPets.filter(pet => {
        const dist = haversine(lat, lng, pet.latitude, pet.longitude);
        return dist <= radiusKm;
      }) : allPets;

      if (filtered.length === 0) return;

      filtered.sort((a, b) => (b.total_licks || 0) - (a.total_licks || 0));

      const champion = filtered[0];
      if (champion && champion.total_licks > 0) {
        await db.run(
          'INSERT INTO spotlight_history (pet_id, area, score, cycle_date) VALUES (?, ?, ?, ?) ON CONFLICT (area, cycle_date) DO NOTHING',
          [champion.id, area, Math.round(champion.total_licks), cycleDateStr]
        );
      }
    } catch (e) {
      console.error('Error saving lazy spotlight history:', e.message);
    }
  }

  async getHistory(area) {
    const history = await db.all(`
      SELECT h.*, p.name, p.pet_username, p.avatar_url, p.breed_name
      FROM spotlight_history h
      JOIN pets p ON h.pet_id = p.id
      WHERE h.area = ?
      ORDER BY h.cycle_date DESC
      LIMIT 30
    `, [area]);
    return history;
  }

  async isChampion(petId, lat, lng, clientCycleStart = null) {
    if (!lat || !lng) return null;
    const areas = ['locality', 'city', 'country', 'region'];
    for (const area of areas) {
      const result = await this.getTopPets(area, lat, lng, clientCycleStart);
      if (result.top3?.[0]?.id === petId) {
        return { is_champion: true, area };
      }
    }
    return null;
  }

  clearCache() {
    cache = {};
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export default new SpotlightRepository();