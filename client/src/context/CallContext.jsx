import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useSocket } from './SocketContext';
import CallModal from '../components/CallModal';

const CallContext = createContext({ startCall: () => {} });

export function CallProvider({ children }) {
  const { getSocket } = useSocket();
  const [activeCall, setActiveCall] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onIncomingCall = ({ callId, from, type, callerPet }) => {
      setActiveCall({
        type,
        name: callerPet?.name || 'Playmate',
        username: callerPet?.pet_username || '',
        avatar: callerPet?.avatar_url || '/logo.png',
        petId: callerPet?.id || null,
        isIncoming: true,
        callId,
        toUserId: from,
      });
    };

    socket.on('call_incoming', onIncomingCall);
    return () => socket.off('call_incoming', onIncomingCall);
  }, [getSocket]);

  const startCall = useCallback(({ type, name, username, avatar, petId, toUserId }) => {
    setActiveCall({
      type,
      name,
      username,
      avatar,
      petId,
      isIncoming: false,
      callId: null,
      toUserId,
    });
  }, []);

  const endCall = useCallback(() => {
    setActiveCall(null);
  }, []);

  return (
    <CallContext.Provider value={{ startCall }}>
      {children}
      {activeCall && (
        <CallModal
          type={activeCall.type}
          partnerName={activeCall.name}
          partnerUsername={activeCall.username}
          partnerAvatar={activeCall.avatar}
          partnerPetId={activeCall.petId}
          isIncoming={activeCall.isIncoming}
          callId={activeCall.callId}
          toUserId={activeCall.toUserId}
          onEnd={endCall}
        />
      )}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}