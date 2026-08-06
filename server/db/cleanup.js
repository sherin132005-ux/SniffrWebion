import db from './connection.js';

// refresh_tokens accumulates one row per login/refresh and is never pruned
// otherwise -- revoked/expired rows just sit there forever. See
// AUDIT_REPORT.md. Runs once at boot, then every 24h.
export async function cleanupRefreshTokens() {
  try {
    const result = await db.run(
      "DELETE FROM refresh_tokens WHERE revoked = 1 OR expires_at < NOW()"
    );
    if (result.rowCount) {
      console.log(`[cleanup] Removed ${result.rowCount} revoked/expired refresh_tokens rows`);
    }
  } catch (err) {
    console.error('[cleanup] refresh_tokens cleanup failed:', err.message);
  }
}

export function startCleanupJobs() {
  cleanupRefreshTokens();
  setInterval(cleanupRefreshTokens, 24 * 60 * 60 * 1000);
}
