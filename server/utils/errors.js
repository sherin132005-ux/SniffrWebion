import config from '../config.js';

// Centralizes what an unexpected server error looks like in an API response.
// The real error is always logged server-side; the client only ever sees
// raw internals (table/column/constraint names, stack fragments) when
// NODE_ENV=development. Previously every route inlined `err.message`
// directly into the response in every environment -- see AUDIT_REPORT.md.
export function sendServerError(res, err, status = 500) {
  console.error('[SERVER_ERROR]', err);
  const message = config.NODE_ENV === 'development'
    ? err.message
    : 'Something went wrong. Please try again.';
  return res.status(status).json({ error: 'SERVER_ERROR', message });
}
