// Every premium-gated backend route (see server/services/premiumGate.js)
// fails with one of these error codes. Centralized here so every page
// handles "this needs Premium" the same way -- catch, check, show
// UpsellModal -- instead of re-deriving the list of codes per call site.
const PREMIUM_GATE_ERROR_CODES = new Set([
  'PET_LIMIT_REACHED',
  'COMMUNITY_JOIN_LIMIT_REACHED',
  'COMMUNITY_CREATE_LIMIT_REACHED',
  'UNDO_LIKE_PREMIUM_ONLY',
  'SUPER_SNIFF_PREMIUM_ONLY',
]);

export function isPremiumGateError(err) {
  return !!err && PREMIUM_GATE_ERROR_CODES.has(err.code);
}
