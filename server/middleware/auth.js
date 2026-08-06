import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config.js';
import db from '../db/connection.js';

export function generateAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, config.JWT_ACCESS_SECRET, { expiresIn: config.ACCESS_TOKEN_EXPIRY });
}

export async function generateRefreshToken(user, deviceInfo = 'unknown') {
  const token = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRY_MS).toISOString();
  await db.run('INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at) VALUES (?, ?, ?, ?)',
    [user.id, tokenHash, deviceInfo, expiresAt]);
  return token;
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET);
}

export async function verifyRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await db.get(
    "SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()",
    [tokenHash]
  );
  return record || null;
}

export async function revokeRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
}

export async function revokeAllUserTokens(userId) {
  await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]);
}

export function authenticateAccess(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'NO_TOKEN', message: 'Access token required' });
  }
  try {
    const decoded = verifyAccessToken(authHeader.split(' ')[1]);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Access token expired' });
    }
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid access token' });
  }
}

export function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = verifyAccessToken(token);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
}