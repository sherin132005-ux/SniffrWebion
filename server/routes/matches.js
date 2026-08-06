import { Router } from 'express';
import { authenticateAccess } from '../middleware/auth.js';
import MatchRepo from '../models/MatchRepository.js';
import PetRepo from '../models/PetRepository.js';
import NotificationRepo from '../models/NotificationRepository.js';
import UserRepo from '../models/UserRepository.js';
import { sendRealtimeNotification } from '../socket/notifications.js';
import { canUndoLike } from '../services/premiumGate.js';
import { sendServerError } from '../utils/errors.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import config from '../config.js';

const router = Router();
router.use(authenticateAccess);

const FIVE_MINS_MS = 5 * 60 * 1000;
const UNDO_WINDOW_MS = 5000;

// swipeId -> setTimeout handle. Lets POST /undo cancel a pending commit before
// it fires. Purely an optimization/cleanup -- commitPendingLike() re-checks the
// swipe's status itself, so even an uncancelled timer is a safe no-op post-undo.
const pendingCommitTimers = new Map();

async function sendMatchNotifications(io, matchId, petA, petB) {
  await sendRealtimeNotification(io, petA.user_id, {
    category: 'matches',
    type: 'new_match',
    title: "It's a Match! 🎉",
    description: `You and ${petB.name} matched! Start chatting.`,
    avatarUrl: petB.avatar_url,
    targetId: String(matchId),
    senderPetId: petB.id,
    actionStatus: 'accepted',
  });
  await sendRealtimeNotification(io, petB.user_id, {
    category: 'matches',
    type: 'new_match',
    title: "It's a Match! 🎉",
    description: `You and ${petA.name} matched! Start chatting.`,
    avatarUrl: petA.avatar_url,
    targetId: String(matchId),
    senderPetId: petA.id,
    actionStatus: 'accepted',
  });
}

// Runs once the 5s undo window elapses. commitSwipe() is the only path that
// ever creates a match now -- POST /like never does this synchronously, which
// is what guarantees a match can't form until both sides' undo windows (if any
// are still open) have closed.
async function commitPendingLike(io, swipeId) {
  pendingCommitTimers.delete(swipeId);
  try {
    const result = await MatchRepo.commitSwipe(swipeId);
    if (result.matched) {
      const [petA, petB] = await Promise.all([
        PetRepo.findById(result.fromPetId),
        PetRepo.findById(result.toPetId),
      ]);
      if (petA && petB) {
        await sendMatchNotifications(io, result.matchId, petA, petB);
      }
    }
  } catch (err) {
    console.error('Failed to commit pending like:', err);
  }
}

// GET /api/matches/discover?lat=&lng=&radius= — nearby swipeable pets
// (excludes own pet, existing matches, pets swiped on within the last
// 20 days, and pets already liked -- see MatchRepo.getExcludedMeetPetIds)
router.get('/discover', async (req, res) => {
  try {
    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.status(400).json({ error: 'NO_PET', message: 'Create a pet profile first' });

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 15;
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'MISSING_LOCATION', message: 'Location is required to discover nearby pets.' });
    }

    const excludeIds = await MatchRepo.getExcludedMeetPetIds(myPet.id);
    const nearby = await PetRepo.findNearby(lat, lng, radius, excludeIds, 1, 50);
    const blockedUserIds = await UserRepo.getBlockedUserIds(req.user.id);

    const now = Date.now();
    const pets = nearby
      .filter(p => !blockedUserIds.includes(p.user_id))
      .map(p => ({
        ...p,
        online: p.last_active_at ? (now - new Date(p.last_active_at).getTime()) < FIVE_MINS_MS : false,
      }));

    res.json({ pets });
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/matches/activity — requested (outgoing), pending (incoming), accepted (mutual)
router.get('/activity', async (req, res) => {
  try {
    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.json({ requested: [], pending: [], accepted: [] });

    const activity = await MatchRepo.getMeetActivityLists(myPet.id);
    res.json(activity);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/matches — full mutual-match list (used by Meet, Chat, and the Share Sheet)
router.get('/', async (req, res) => {
  try {
    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.json({ matches: [], total: 0, page: 1, hasMore: false });

    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const result = await MatchRepo.getMatches(myPet.id, page, limit);
    res.json(result);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/matches/like/:petId — swipe right. Stores the like as 'pending' and
// gives the sender a 5s undo window (see POST /undo/:petId) before it commits
// and match-detection runs. The recipient gets an immediate "someone liked you"
// notification either way -- only the match itself waits on the undo window.
router.post('/like/:petId', rateLimiter(config.RATE_LIMIT.POST), async (req, res) => {
  try {
    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.status(400).json({ error: 'NO_PET', message: 'Create a pet profile first' });

    const targetPetId = parseInt(req.params.petId, 10);
    if (isNaN(targetPetId)) return res.status(400).json({ error: 'INVALID_ID' });

    const targetPet = await PetRepo.findById(targetPetId);
    if (!targetPet) return res.status(404).json({ error: 'NOT_FOUND' });

    if (await UserRepo.isBlocked(req.user.id, targetPet.user_id)) {
      return res.status(403).json({ error: 'BLOCKED', message: 'You cannot interact with this profile.' });
    }

    const swipe = await MatchRepo.createPendingLike(myPet.id, targetPetId);

    const io = req.app.get('io');
    if (io) {
      const notification = await sendRealtimeNotification(io, targetPet.user_id, {
        category: 'matches',
        type: 'meet_like',
        title: `${myPet.name} sent you a treat! 🦴`,
        description: `${myPet.name} liked your profile on Meet. Like them back to match!`,
        avatarUrl: myPet.avatar_url,
        targetId: String(myPet.id),
        senderPetId: myPet.id,
        actionStatus: 'pending',
      });
      if (notification) {
        await MatchRepo.attachNotificationId(swipe.id, notification.id);
      }
    }

    const timer = setTimeout(() => commitPendingLike(io, swipe.id), UNDO_WINDOW_MS);
    pendingCommitTimers.set(swipe.id, timer);

    res.json({ pending: true, swipeId: swipe.id, undoWindowMs: UNDO_WINDOW_MS, matched: false });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/matches/undo/:petId — cancel a like within its 5s undo window.
// Deletes the pending swipe (the profile becomes swipeable again), cancels the
// scheduled commit, and retracts the recipient's "someone liked you" notification
// both from the DB and live from their open Notifications panel.
// Premium-gated (Undo Like): free users still see the snackbar/button in the
// UI (that's a frontend concern, unchanged), but the actual undo is rejected
// here -- the pending like still commits normally on its own 5s timer either way.
router.post('/undo/:petId', rateLimiter(config.RATE_LIMIT.POST), async (req, res) => {
  try {
    const io = req.app.get('io');
    const premiumCheck = await canUndoLike(req.user.id, io);
    if (!premiumCheck.allowed) {
      return res.status(403).json({ error: premiumCheck.reason, message: 'Undo Like is a Premium feature.', plan: premiumCheck.plan });
    }

    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.status(400).json({ error: 'NO_PET', message: 'Create a pet profile first' });

    const targetPetId = parseInt(req.params.petId, 10);
    if (isNaN(targetPetId)) return res.status(400).json({ error: 'INVALID_ID' });

    const undone = await MatchRepo.undoLike(myPet.id, targetPetId);
    if (!undone) {
      return res.status(410).json({ error: 'TOO_LATE', message: 'This like has already been confirmed and can no longer be undone.' });
    }

    const timer = pendingCommitTimers.get(undone.swipeId);
    if (timer) {
      clearTimeout(timer);
      pendingCommitTimers.delete(undone.swipeId);
    }

    if (undone.notificationId) {
      const removedNotif = await NotificationRepo.deleteById(undone.notificationId);
      if (removedNotif && io) {
        const unreadCount = await NotificationRepo.getUnreadCount(removedNotif.user_id);
        io.to(`user_${removedNotif.user_id}`).emit('notification_removed', {
          notificationId: undone.notificationId,
          unreadCount,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/matches/decline/:petId — swipe left
router.post('/decline/:petId', rateLimiter(config.RATE_LIMIT.POST), async (req, res) => {
  try {
    const myPet = await PetRepo.getActivePet(req.user.id);
    if (!myPet) return res.status(400).json({ error: 'NO_PET', message: 'Create a pet profile first' });

    const targetPetId = parseInt(req.params.petId, 10);
    if (isNaN(targetPetId)) return res.status(400).json({ error: 'INVALID_ID' });

    await MatchRepo.swipe(myPet.id, targetPetId, 'decline');
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

export default router;
