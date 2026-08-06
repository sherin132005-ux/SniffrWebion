// Meet/live-location room. Location updates are only ever broadcast to
// sockets that have explicitly joined this room (i.e. someone actively on
// the Meet page), never to every connected socket app-wide -- see
// AUDIT_REPORT.md's location_updated finding for why this room exists.
export function setupMeetSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join_meet', () => {
      socket.join('meet_live');
    });

    socket.on('leave_meet', () => {
      socket.leave('meet_live');
    });

    socket.on('disconnect', () => {
      socket.leave('meet_live');
    });
  });
}
