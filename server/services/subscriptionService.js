import db from '../db/connection.js';
import {
  getPlan,
  LAUNCH_OFFER_PLAN,
  LAUNCH_OFFER_USER_LIMIT,
  SUBSCRIPTION_PERIOD_DAYS,
} from '../config/plans.js';
import { getGateway } from './paymentGateway.js';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// "Has premium access right now" -- true for 'active' (will auto-renew) and
// for 'cancelled' (won't renew, but the already-paid-for period hasn't
// ended yet). Only 'expired'/'inactive' actually lose access. Exported so
// PetRepository can compute the same is_premium/badge logic in one place
// (see attachCompletionStats) rather than duplicating the rule.
export function hasCurrentAccess(user) {
  if (user.subscription_status !== 'active' && user.subscription_status !== 'cancelled') return false;
  if (!user.plan_expiry_date) return false;
  return new Date(user.plan_expiry_date) > new Date();
}

export function emitPremiumUpdate(io, user) {
  if (!io) return;
  io.to(`user_${user.id}`).emit('premium_status_updated', serializePremiumState(user));
}

// Emits an already-built state object as-is (used when the caller needs to
// attach extra fields getFullPremiumState computes, e.g. hasPendingCheckout,
// that serializePremiumState alone can't see since it never touches the DB).
export function emitPremiumState(io, userId, state) {
  if (!io) return;
  io.to(`user_${userId}`).emit('premium_status_updated', state);
}

// Billing status is a small state machine derived from the same two fields
// hasCurrentAccess() already reads -- kept here as the single place that
// decides the label so the frontend never hardcodes this text itself.
const BILLING_STATUS_LABELS = {
  active: 'Active',
  cancelled: 'Cancelled (active until renewal date)',
  expired: 'Expired',
  inactive: 'Active (Free Tier)',
};

function getBillingStatus(user, active) {
  if (active) return user.subscription_status === 'cancelled' ? 'cancelled' : 'active';
  return user.subscription_status === 'expired' ? 'expired' : 'inactive';
}

// The one shape every route/socket event sends to the client -- so the
// frontend never has to re-derive "am I premium" from raw DB fields itself.
export function serializePremiumState(user) {
  const active = hasCurrentAccess(user);
  const effectivePlanKey = active ? user.current_plan : 'free';
  const plan = getPlan(effectivePlanKey);
  const billingStatus = getBillingStatus(user, active);
  return {
    currentPlan: effectivePlanKey,
    planSource: user.plan_source,
    subscriptionStatus: user.subscription_status,
    planStartDate: user.plan_start_date,
    planExpiryDate: user.plan_expiry_date,
    autoRenew: !!user.auto_renew,
    premiumBadgeEnabled: !!user.premium_badge_enabled,
    isFoundingMember: !!user.is_founding_member,
    isPremium: active && effectivePlanKey !== 'free',
    boostCreditsRemaining: active ? user.boost_credits_remaining : 0,
    hasEarlyAccess: active && plan.hasEarlyAccess,
    canUndoLike: active && plan.canUndoLike,
    canUseSuperSniff: active && plan.canUseSuperSniff,
    limits: {
      maxCommunitiesJoined: plan.maxCommunitiesJoined,
      maxCommunitiesCreated: plan.maxCommunitiesCreated,
      maxPets: plan.maxPets,
    },
    adFrequency: plan.adFrequency,
    billingStatus,
    billingStatusLabel: BILLING_STATUS_LABELS[billingStatus],
    // Only getFullPremiumState() (which does an extra DB read) can know this
    // is actually true -- default false here so every other emit path stays
    // correct without needing to know about payment_sessions at all.
    hasPendingCheckout: false,
  };
}

// Lazily expires a subscription whose period has ended. Called on every
// plan-state read, so an expiry is reflected on the very next request/gate
// check without needing a background cron job -- and fires the same
// realtime event a real expiry job would.
async function checkAndExpireIfNeeded(user, io = null) {
  if (user.subscription_status !== 'active' && user.subscription_status !== 'cancelled') return user;
  if (!user.plan_expiry_date || new Date(user.plan_expiry_date) > new Date()) return user;

  await db.run("UPDATE users SET subscription_status = 'expired', boost_credits_remaining = 0 WHERE id = ?", [user.id]);
  await db.run(
    'INSERT INTO plan_history (user_id, plan, source, action) VALUES (?, ?, ?, ?)',
    [user.id, user.current_plan, user.plan_source, 'expired']
  );

  const updated = { ...user, subscription_status: 'expired', boost_credits_remaining: 0 };
  emitPremiumUpdate(io, updated);
  return updated;
}

export async function getUserWithFreshPlanState(userId, io = null) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  return checkAndExpireIfNeeded(user, io);
}

// Also attaches whether the user has a payment session awaiting
// confirmation (recent, unresolved) -- the one extra bit of state
// serializePremiumState() can't compute on its own since it's a pure
// function of the users row and never touches payment_sessions.
export async function getFullPremiumState(userId, io = null) {
  const user = await getUserWithFreshPlanState(userId, io);
  if (!user) return null;
  const state = serializePremiumState(user);
  const pendingSession = await db.get(
    `SELECT id FROM payment_sessions
     WHERE user_id = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '30 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (pendingSession) {
    state.billingStatus = 'pending';
    state.billingStatusLabel = 'Pending';
    state.hasPendingCheckout = true;
  }
  return state;
}

// ─── Payment-abstraction-ready activation ──────────────────────────────
// Called only from confirmCheckoutSession() below (after the gateway has
// confirmed payment) or from grantLaunchOfferIfEligible() (free grant, no
// payment involved at all). Never called directly from a route anymore --
// there is no path from an HTTP request to an activated plan that skips
// checkout/confirm.
export async function subscribeToPlan(userId, planKey, { source = 'paid', amountPaid = null, io = null, paymentSessionId = null } = {}) {
  const plan = getPlan(planKey);
  const now = new Date();
  const expiry = addDays(now, SUBSCRIPTION_PERIOD_DAYS);
  const paid = amountPaid !== null ? amountPaid : plan.priceInr;

  const before = await db.get('SELECT current_plan, subscription_status, plan_expiry_date FROM users WHERE id = ?', [userId]);
  const hadActiveAccess = !!(before && hasCurrentAccess(before));

  // Classify the billing event so plan_history/Billing History can show
  // "Upgraded from Plus" vs. a plain "Subscribed" -- source='launch_offer'
  // always wins regardless of prior state (it's a gift, never a renewal).
  let action = 'subscribed';
  let previousPlan = null;
  if (source === 'launch_offer') {
    action = 'launch_offer_granted';
  } else if (hadActiveAccess) {
    previousPlan = before.current_plan;
    if (before.current_plan === planKey) {
      action = 'renewed';
    } else {
      action = getPlan(planKey).priceInr > getPlan(before.current_plan).priceInr ? 'upgraded' : 'downgraded';
    }
  }

  await db.run(
    `UPDATE users SET
       current_plan = ?, plan_source = ?, subscription_status = 'active',
       plan_start_date = ?, plan_expiry_date = ?, auto_renew = 1,
       boost_credits_remaining = ?, boost_credits_refreshed_at = ?
     WHERE id = ?`,
    [planKey, source, now.toISOString(), expiry.toISOString(), plan.boostCreditsPerCycle, now.toISOString(), userId]
  );
  await db.run(
    'INSERT INTO plan_history (user_id, plan, source, action, amount_paid, previous_plan, payment_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, planKey, source, action, paid, previousPlan, paymentSessionId]
  );

  const user = await getUserWithFreshPlanState(userId, io);
  emitPremiumUpdate(io, user);
  return user;
}

// ─── Checkout: Step 1 — create a payment session ───────────────────────
// Creates a session with the active gateway (mock today) and records it as
// 'pending'. Crucially, this does NOT touch the user's plan at all -- an
// abandoned checkout has zero effect on their account. Mirrors exactly what
// "create a Razorpay order" / "create a Stripe PaymentIntent" would do.
export async function createCheckoutSession(userId, planKey, provider = 'mock', io = null) {
  const plan = getPlan(planKey);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('USER_NOT_FOUND');

  const gateway = getGateway(provider);
  const { providerReference, clientData } = await gateway.createSession({
    plan: planKey,
    amountInr: plan.priceInr,
    user,
  });

  const result = await db.run(
    `INSERT INTO payment_sessions (user_id, plan, amount, provider, status, provider_reference)
     VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id`,
    [userId, planKey, plan.priceInr, provider, providerReference]
  );
  const sessionId = result.rows[0].id;

  // Live-reflect the new "Pending" billing status immediately, in case the
  // user has Manage Subscription open in another tab.
  const state = await getFullPremiumState(userId, io);
  emitPremiumState(io, userId, state);

  return { sessionId, plan: planKey, amount: plan.priceInr, provider, clientData, state };
}

// ─── Checkout: Step 2 — confirm payment, then activate the plan ────────
// In production this is what a signature-verified provider webhook would
// call, NOT something the client invokes directly. The mock gateway has no
// real webhook, so the frontend calls this itself once the (simulated)
// payment method step completes -- swapping in a real provider means
// moving this call into a webhook handler; nothing here changes.
export async function confirmCheckoutSession(userId, sessionId, io = null) {
  const session = await db.get('SELECT * FROM payment_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!session) return { success: false, reason: 'SESSION_NOT_FOUND' };
  if (session.status === 'succeeded') return { success: false, reason: 'ALREADY_CONFIRMED' };
  if (session.status !== 'pending') return { success: false, reason: 'SESSION_NOT_PENDING' };

  const gateway = getGateway(session.provider);
  const result = await gateway.confirmSession(session);
  if (!result.success) {
    await db.run("UPDATE payment_sessions SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [sessionId]);
    return { success: false, reason: 'PAYMENT_FAILED' };
  }

  await db.run("UPDATE payment_sessions SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [sessionId]);

  const user = await subscribeToPlan(userId, session.plan, {
    source: 'paid',
    amountPaid: Number(session.amount),
    io,
    paymentSessionId: sessionId,
  });

  return { success: true, user };
}

// Stops auto-renew but keeps access until the already-paid-for period ends
// (realistic SaaS behavior) -- checkAndExpireIfNeeded() flips it to
// 'expired' once plan_expiry_date actually passes.
export async function cancelSubscription(userId, io = null) {
  await db.run(
    "UPDATE users SET auto_renew = 0, subscription_status = 'cancelled' WHERE id = ? AND subscription_status = 'active'",
    [userId]
  );
  const user = await getUserWithFreshPlanState(userId, io);
  if (user) {
    await db.run(
      'INSERT INTO plan_history (user_id, plan, source, action) VALUES (?, ?, ?, ?)',
      [userId, user.current_plan, user.plan_source, 'cancelled']
    );
    emitPremiumUpdate(io, user);
  }
  return user;
}

// Launch offer: first LAUNCH_OFFER_USER_LIMIT signups get free
// LAUNCH_OFFER_PLAN, tracked as plan_source='launch_offer' (never 'paid')
// so a later real subscription can't be confused with this grant.
// Call this AFTER the new user row has already been inserted, so
// COUNT(*) includes the new user itself -- COUNT<=limit is then exactly
// "this user is among the first `limit` ever created."
export async function grantLaunchOfferIfEligible(userId, io = null) {
  const countRow = await db.get('SELECT COUNT(*) as count FROM users');
  const totalUsers = Number(countRow?.count || 0);
  if (totalUsers > LAUNCH_OFFER_USER_LIMIT) return null;

  await db.run('UPDATE users SET is_founding_member = 1, welcome_slider_seen = 0 WHERE id = ?', [userId]);
  return subscribeToPlan(userId, LAUNCH_OFFER_PLAN, { source: 'launch_offer', amountPaid: 0, io });
}

export async function markWelcomeSliderSeen(userId) {
  await db.run('UPDATE users SET welcome_slider_seen = 1 WHERE id = ?', [userId]);
}
