import { Router } from 'express';
import { authenticateAccess } from '../middleware/auth.js';
import NotificationRepo from '../models/NotificationRepository.js';
import PetRepo from '../models/PetRepository.js';
import { sendRealtimeNotification } from '../socket/notifications.js';
import { sendServerError } from '../utils/errors.js';

const router = Router();
router.use(authenticateAccess);

// GET /api/notifications (with pagination & category filtering)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const category = req.query.category || 'all';

    const result = await NotificationRepo.getByUserId(req.user.id, { page, limit, category });
    res.json(result);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const unreadCount = await NotificationRepo.getUnreadCount(req.user.id);
    res.json({ unreadCount });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const updated = await NotificationRepo.markAsRead(parseInt(req.params.id, 10), req.user.id);
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND' });
    const unreadCount = await NotificationRepo.getUnreadCount(req.user.id);
    res.json({ success: true, notification: updated, unreadCount });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    await NotificationRepo.markAllAsRead(req.user.id);
    res.json({ success: true, unreadCount: 0 });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/notifications/match-request/:id/respond
// Handles Accept/Decline pressed directly on a "New Match Request" notification card.
router.post('/match-request/:id/respond', async (req, res) => {
  try {
    const { action } = req.body; // 'accept' | 'decline'
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'INVALID_ACTION', message: 'action must be accept or decline' });
    }

    const result = await NotificationRepo.respondToMatchRequest(parseInt(req.params.id, 10), req.user.id, action);
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });

    // If accepting created a real mutual match, notify BOTH users with "It's a Match"
    if (action === 'accept' && result.matchResult?.matched) {
      const io = req.app.get('io');
      const myPet = await PetRepo.getActivePet(req.user.id);
      const senderPetId = result.notification?.sender_pet_id;
      const senderPet = senderPetId ? await PetRepo.findById(senderPetId) : null;

      if (io && myPet) {
        if (senderPet) {
          sendRealtimeNotification(io, senderPet.user_id, {
            category: 'matches',
            type: 'new_match',
            title: "It's a Match! 🎉",
            description: `You and ${myPet.name} matched! Start chatting.`,
            avatarUrl: myPet.avatar_url,
            targetId: String(result.matchResult.matchId),
            senderPetId: myPet.id,
            actionStatus: 'accepted',
          });
        }
        await sendRealtimeNotification(io, req.user.id, {
          category: 'matches',
          type: 'new_match',
          title: "It's a Match! 🎉",
          description: `You and ${senderPet?.name || 'your playmate'} matched! Start chatting.`,
          avatarUrl: senderPet?.avatar_url,
          targetId: String(result.matchResult.matchId),
          senderPetId: senderPetId,
          actionStatus: 'accepted',
        });
      }
    }
    // Decline: no notification sent to anyone (matches spec)

    const unreadCount = await NotificationRepo.getUnreadCount(req.user.id);
    res.json({ success: true, ...result, unreadCount });
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/notifications/preferences
router.get('/preferences', async (req, res) => {
  try {
    const preferences = await NotificationRepo.getPreferences(req.user.id);
    res.json({ preferences });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/notifications/preferences
router.post('/preferences', async (req, res) => {
  try {
    const preferences = await NotificationRepo.updatePreferences(req.user.id, req.body);
    res.json({ success: true, preferences });
  } catch (err) {
    sendServerError(res, err);
  }
});

export default router;