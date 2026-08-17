const stores = new Map();

export function rateLimiter({ windowMs = 60000, max = 60 } = {}) {
  return (req, res, next) => {
    // Keyed per route, not per router mount point -- `req.baseUrl` alone
    // (e.g. '/api/auth') put every sub-route (login, signup, 2FA, refresh,
    // logout, /me) in one shared bucket, so hammering /login could lock a
    // user out of /signup or /logout too. See AUDIT_REPORT.md.
    const key = `${req.ip}_${req.method}_${req.baseUrl}${req.path}`;
    const now = Date.now();
    let record = stores.get(key);
    if (!record || now - record.start > windowMs) {
      record = { start: now, count: 0 };
      stores.set(key, record);
    }
    record.count++;
    if (record.count > max) {
      const retryAfter = Math.ceil((record.start + windowMs - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many requests', retryAfter });
    }
    next();
  };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of stores) {
    if (now - record.start > 120000) stores.delete(key);
  }
}, 60000);
