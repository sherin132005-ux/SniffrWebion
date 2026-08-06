import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { initDb } from './db/connection.js';
import { startCleanupJobs } from './db/cleanup.js';
import { authenticateSocket } from './middleware/auth.js';
import { setupChatSocket } from './socket/chat.js';
import { setupCallSocket } from './socket/calls.js';
import { setupNotificationSocket } from './socket/notifications.js';
import { setupCommunitySocket } from './socket/communities.js';
import { setupMeetSocket } from './socket/meet.js';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import matchRoutes from './routes/matches.js';
import chatRoutes from './routes/chat.js';
import profileRoutes from './routes/profile.js';
import spotlightRoutes from './routes/spotlight.js';
import privacyRoutes from './routes/privacy.js';
import communityRoutes from './routes/communities.js';
import notificationRoutes from './routes/notifications.js';
import premiumRoutes from './routes/premium.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
  // Initialize database (Postgres via Supabase)
  await initDb();
  startCleanupJobs();

  const app = express();
  // Deployed behind Railway's edge proxy -- without this, req.ip resolves
  // to the proxy's address for every request, collapsing the IP-keyed rate
  // limiter into one shared bucket for the entire platform instead of one
  // per real visitor. See AUDIT_REPORT.md.
  app.set('trust proxy', 1);
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: config.CORS_ORIGINS, methods: ['GET', 'POST'] }
  });

  // Middleware
  app.set('io', io);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(express.json());

  // Static files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/matches', matchRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/spotlight', spotlightRoutes);
  app.use('/api/privacy', privacyRoutes);
  app.use('/api/communities', communityRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/premium', premiumRoutes);

  // Health check
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Socket.IO auth
  io.use(authenticateSocket);

  // Socket handlers
  setupChatSocket(io);
  setupCallSocket(io);
  setupNotificationSocket(io);
  setupCommunitySocket(io);
  setupMeetSocket(io);

  // Graceful shutdown (Postgres pool closes its own connections automatically)
  process.on('SIGINT', () => process.exit());
  process.on('SIGTERM', () => process.exit());

  server.listen(config.PORT, () => {
    console.log(`🐾 Sniffr server running on http://localhost:${config.PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});