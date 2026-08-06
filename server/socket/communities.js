import CommunityRepo from '../models/CommunityRepository.js';

export function setupCommunitySocket(io) {
  io.on('connection', (socket) => {
    const userId = socket.user.id;

    socket.on('join_community_chat', ({ communityId }) => {
      socket.join(`pawcircle_${communityId}`);
    });

    socket.on('leave_community_chat', ({ communityId }) => {
      socket.leave(`pawcircle_${communityId}`);
    });

    socket.on('community_typing', ({ communityId, isTyping }) => {
      socket.to(`pawcircle_${communityId}`).emit('community_user_typing', {
        communityId,
        userId,
        username: socket.user.username,
        isTyping
      });
    });

    socket.on('send_community_message', async ({ communityId, content, mediaUrl }) => {
      try {
        const message = await CommunityRepo.addMessage({
          community_id: communityId,
          sender_id: userId,
          content: content || '',
          media_url: mediaUrl || null
        });
        io.to(`pawcircle_${communityId}`).emit('community_message_received', message);
      } catch (e) {
        console.error('[send_community_message error]', e);
      }
    });
  });
}
