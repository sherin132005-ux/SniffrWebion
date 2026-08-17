import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load .env manually (no dotenv dependency needed) ──────────
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dir, '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* .env is optional */ }

// JWT secrets must come from the environment -- no hardcoded fallback.
// A silent fallback here means a misconfigured deployment issues tokens
// signed with a value that could be sitting in source/history somewhere,
// instead of failing loudly at boot the way a missing secret should.
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!process.env[key]) {
    throw new Error(`[config] ${key} is not set. Set it in server/.env before starting the server.`);
  }
}

// CORS_ORIGINS: '*' means "allow any origin" and must stay the literal
// string the `cors` package recognizes as a wildcard. Any other value is a
// comma-separated allowlist and gets split into an array. (Splitting '*'
// itself would turn it into the array ['*'], which `cors` treats as a
// literal allowed origin string -- one no real browser will ever send --
// silently blocking every real cross-origin request instead of allowing them.)
function parseCorsOrigins(raw) {
  if (!raw || raw === '*') return '*';
  return raw.split(',').map(o => o.trim()).filter(Boolean);
}

export default {
  PORT:                  process.env.PORT                  || 3001,
  NODE_ENV:              process.env.NODE_ENV               || 'development',
  // The deployed frontend's real origin (e.g. the Vercel URL) -- used to
  // build links in transactional emails (verification, password reset,
  // admin payment review). Already set in server/.env; this was just
  // never re-exported here, so every caller's `config.CLIENT_URL || '...'`
  // silently fell back to the localhost default in every environment.
  CLIENT_URL:            process.env.CLIENT_URL             || 'http://localhost:5173',
  JWT_ACCESS_SECRET:     process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET:    process.env.JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRY:  '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  REFRESH_TOKEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  STORAGE_TYPE: process.env.STORAGE_TYPE || 'local',
  UPLOAD_DIR:  process.env.UPLOAD_DIR  || './uploads',
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
  RATE_LIMIT: {
    AUTH: { windowMs: 60000, max: 20 },
    POST: { windowMs: 60000, max: 10 },
    GET:  { windowMs: 60000, max: 60 },
  },
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),

  SPOTLIGHT_CACHE_TTL:     5 * 60 * 1000,
  SPOTLIGHT_RANKING_DAYS:  7,

  // ── OAuth credentials (filled from .env) ─────────────────────
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  APPLE_SERVICE_ID:     process.env.APPLE_SERVICE_ID     || '',
  APPLE_TEAM_ID:        process.env.APPLE_TEAM_ID        || '',
  APPLE_KEY_ID:         process.env.APPLE_KEY_ID         || '',
  APPLE_PRIVATE_KEY:    process.env.APPLE_PRIVATE_KEY    || '',

  // ── Cloudinary (media storage) ────────────────────────────────

  CLOUDINARY_CLOUD_NAME:   process.env.CLOUDINARY_CLOUD_NAME   || '',
  CLOUDINARY_API_KEY:      process.env.CLOUDINARY_API_KEY      || '',
  CLOUDINARY_API_SECRET:   process.env.CLOUDINARY_API_SECRET   || '',
};