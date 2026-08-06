import { Router } from 'express';
import { authenticateAccess } from '../middleware/auth.js';
import { PLANS, PLAN_KEYS, isValidPlanKey } from '../config/plans.js';
import {
  getFullPremiumState,
  serializePremiumState,
  cancelSubscription,
  markWelcomeSliderSeen,
  createCheckoutSession,
  confirmCheckoutSession,
} from '../services/subscriptionService.js';
import { consumeBoostCredit } from '../services/premiumGate.js';
import db from '../db/connection.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import config from '../config.js';
import { sendServerError } from '../utils/errors.js';

const router = Router();
router.use(authenticateAccess);

// GET /api/premium/plans — public catalog for the upgrade modal. No auth
// state needed beyond being logged in; same PLANS registry every gate
// check reads from, so the modal can never drift out of sync with what's
// actually enforced server-side.
router.get('/plans', async (req, res) => {
  try {
    res.json({
      plans: PLAN_KEYS.map(key => ({
        key,
        label: PLANS[key].label,
        priceInr: PLANS[key].priceInr,
        maxCommunitiesJoined: PLANS[key].maxCommunitiesJoined === Infinity ? null : PLANS[key].maxCommunitiesJoined,
        maxCommunitiesCreated: PLANS[key].maxCommunitiesCreated === Infinity ? null : PLANS[key].maxCommunitiesCreated,
        maxPets: PLANS[key].maxPets === Infinity ? null : PLANS[key].maxPets,
        canUndoLike: PLANS[key].canUndoLike,
        canUseSuperSniff: PLANS[key].canUseSuperSniff,
        hasEarlyAccess: PLANS[key].hasEarlyAccess,
        hasPremiumBadge: PLANS[key].hasPremiumBadge,
        boostCreditsPerCycle: PLANS[key].boostCreditsPerCycle,
      })),
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/premium/status — the ONE endpoint the frontend calls to know
// everything about the current user's premium state. Always a fresh DB
// read (via getFullPremiumState, which lazily expires stale subscriptions
// AND checks for an in-flight checkout), never trusts anything the client sent.
router.get('/status', async (req, res) => {
  try {
    const io = req.app.get('io');
    const state = await getFullPremiumState(req.user.id, io);
    if (!state) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.json(state);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/premium/checkout { plan } — Step 1 of the payment flow: creates
// a payment session with the active gateway (mock today; a real Razorpay
// order / Stripe PaymentIntent later) but does NOT activate the plan. The
// plan only ever activates via /checkout/:sessionId/confirm below, so there
// is no request path that skips payment.
router.post('/checkout', rateLimiter(config.RATE_LIMIT.POST), async (req, res) => {
  try {
    const { plan } = req.body;
    if (!isValidPlanKey(plan) || plan === 'free') {
      return res.status(400).json({ error: 'INVALID_PLAN', message: 'Choose a valid paid plan.' });
    }
    const io = req.app.get('io');
    const session = await createCheckoutSession(req.user.id, plan, 'mock', io);
    res.json(session);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/premium/checkout/:sessionId/confirm — Step 2: confirms payment
// with the gateway and, only on success, activates the plan.
// ── Where real payments plug in later ──
// For Razorpay/Stripe, this exact logic (gateway.confirmSession + subscribeToPlan)
// moves into a signature-verified webhook handler instead of being called
// directly by the client — createCheckoutSession/confirmCheckoutSession's
// signatures don't need to change for that swap, only who calls them.
router.post('/checkout/:sessionId/confirm', rateLimiter(config.RATE_LIMIT.POST), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    const io = req.app.get('io');
    const result = await confirmCheckoutSession(req.user.id, sessionId, io);
    if (!result.success) {
      return res.status(400).json({ error: result.reason || 'PAYMENT_FAILED' });
    }
    res.json(serializePremiumState(result.user));
  } catch (err) {
    sendServerError(res, err);
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const io = req.app.get('io');
    const user = await cancelSubscription(req.user.id, io);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const state = await getFullPremiumState(req.user.id, io);
    res.json(state);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/premium/boost/use — spends 1 Spotlight Boost credit. Atomic
// server-side decrement (see premiumGate.consumeBoostCredit) -- a client
// can't spend credits it doesn't have by racing this endpoint.
router.post('/boost/use', async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await consumeBoostCredit(req.user.id, io);
    if (!result.success) {
      return res.status(400).json({ error: 'NO_BOOST_CREDITS', message: 'No Spotlight Boost credits remaining.' });
    }
    res.json(result);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/premium/history — powers the Billing History settings modal.
router.get('/history', async (req, res) => {
  try {
    const history = await db.all(
      'SELECT id, plan, source, action, amount_paid, previous_plan, created_at FROM plan_history WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ history });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/premium/welcome-seen — marks the founding-member welcome
// slider as shown, so it never reappears on later logins.
router.post('/welcome-seen', async (req, res) => {
  try {
    await markWelcomeSliderSeen(req.user.id);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

export default router;
