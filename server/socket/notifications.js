import NotificationRepo from '../models/NotificationRepository.js';

export function setupNotificationSocket(io) {
  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    if (userId) {
      socket.join(`user_${userId}`);
    }

    socket.on('post_liked', ({ postId, likeCount }) => {
      io.emit('post_like_update', { postId, likeCount });
    });

    socket.on('new_match', ({ matchedPet }) => {
      socket.broadcast.emit('match_notification', { matchedPet });
    });
  });
}

export async function sendRealtimeNotification(io, userId, notificationData) {
  try {
    const notification = await NotificationRepo.createNotification({
      userId,
      ...notificationData,
    });
    if (notification && io) {
      const unreadCount = await NotificationRepo.getUnreadCount(userId);
      io.to(`user_${userId}`).emit('notification_received', {
        notification,
        unreadCount,
      });
    }
    return notification;
  } catch (err) {
    console.error('Failed to send real-time notification:', err);
    return null;
  }
}
