import db from '../db/connection.js';
import { getPlan } from '../config/plans.js';
import { getUserWithFreshPlanState, serializePremiumState } from './subscriptionService.js';

// The one place every gate check resolves "what plan is this user actually
// on right now" -- reuses the same lazy-expiry logic as everything else,
// so a gate check can never see a stale/expired plan as still active.
async function getEffectivePlan(userId, io = null) {
  const user = await getUserWithFreshPlanState(userId, io);
  if (!user) return { plan: getPlan('free'), state: null };
  const state = serializePremiumState(user);
  return { plan: getPlan(state.currentPlan), state };
}

export async function canAddPet(userId, io = null) {
  const { plan, state } = await getEffectivePlan(userId, io);
  const row = await db.get('SELECT COUNT(*) as count FROM pets WHERE user_id = ?', [userId]);
  const current = Number(row?.count || 0);
  const allowed = current < plan.maxPets;
  return { allowed, reason: allowed ? null : 'PET_LIMIT_REACHED', limit: plan.maxPets, current, plan: state?.currentPlan || 'free' };
}

export async function canJoinCommunity(userId, io = null) {
  const { plan, state } = await getEffectivePlan(userId, io);
  // Only counts memberships gained via POST /:id/join (always role='Member'),
  // deliberately excluding communities the user owns/created -- otherwise
  // the two independently-stated limits (3 joined vs 5 created) would bleed
  // into each other, since creating a community also makes you its member.
  const row = await db.get("SELECT COUNT(*) as count FROM community_members WHERE user_id = ? AND role = 'Member'", [userId]);
  const current = Number(row?.count || 0);
  const allowed = current < plan.maxCommunitiesJoined;
  return { allowed, reason: allowed ? null : 'COMMUNITY_JOIN_LIMIT_REACHED', limit: plan.maxCommunitiesJoined, current, plan: state?.currentPlan || 'free' };
}

export async function canCreateCommunity(userId, io = null) {
  const { plan, state } = await getEffectivePlan(userId, io);
  const row = await db.get("SELECT COUNT(*) as count FROM community_members WHERE user_id = ? AND role = 'Owner'", [userId]);
  const current = Number(row?.count || 0);
  const allowed = current < plan.maxCommunitiesCreated;
  return { allowed, reason: allowed ? null : 'COMMUNITY_CREATE_LIMIT_REACHED', limit: plan.maxCommunitiesCreated, current, plan: state?.currentPlan || 'free' };
}

export async function canUndoLike(userId, io = null) {
  const { plan, state } = await getEffectivePlan(userId, io);
  return { allowed: !!plan.canUndoLike, reason: plan.canUndoLike ? null : 'UNDO_LIKE_PREMIUM_ONLY', plan: state?.currentPlan || 'free' };
}

export async function canUseSuperSniff(userId, io = null) {
  const { plan, state } = await getEffectivePlan(userId, io);
  return { allowed: !!plan.canUseSuperSniff, reason: plan.canUseSuperSniff ? null : 'SUPER_SNIFF_PREMIUM_ONLY', plan: state?.currentPlan || 'free' };
}

export async function hasEarlyAccess(userId, io = null) {
  const { plan } = await getEffectivePlan(userId, io);
  return !!plan.hasEarlyAccess;
}

export async function getAdFrequency(userId, io = null) {
  const { plan } = await getEffectivePlan(userId, io);
  return plan.adFrequency;
}

export async function getSpotlightBoostBalance(userId, io = null) {
  const { state } = await getEffectivePlan(userId, io);
  return state ? state.boostCreditsRemaining : 0;
}

// Atomic decrement -- WHERE boost_credits_remaining > 0 means a client can
// never race this into a negative balance.
export async function consumeBoostCredit(userId, io = null) {
  const balance = await getSpotlightBoostBalance(userId, io);
  if (balance <= 0) return { success: false, remaining: 0 };

  const result = await db.run(
    'UPDATE users SET boost_credits_remaining = boost_credits_remaining - 1 WHERE id = ? AND boost_credits_remaining > 0 RETURNING boost_credits_remaining',
    [userId]
  );
  if (!result.rows.length) return { success: false, remaining: 0 };

  const remaining = result.rows[0].boost_credits_remaining;
  if (io) io.to(`user_${userId}`).emit('boost_credits_updated', { remaining });
  return { success: true, remaining };
}
