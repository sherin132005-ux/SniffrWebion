import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';

export default function CallModal({
  type = 'audio',
  partnerName,
  partnerUsername,
  partnerAvatar,
  partnerPetId,
  isIncoming = false,
  callId: initialCallId = null,
  toUserId = null,
  onEnd
}) {
  const { getSocket } = useSocket();
  const socket = getSocket();

  const [status, setStatus] = useState(isIncoming ? 'ringing' : 'dialing'); // dialing | ringing | connected | ended
  const [duration, setDuration] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(type === 'video');
  const [speakerOn, setSpeakerOn] = useState(true);

  // Network reconnect handling: a temporary ICE disconnect shouldn't kill
  // the call outright -- `reconnecting` shows a non-alarming banner while
  // we try to recover, `connectionLost` is only set once we give up.
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  const [callId, setCallId] = useState(initialCallId);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  // Tracks whether the initial offer/answer has already gone out, so the
  // onnegotiationneeded handler (added for ICE restart) doesn't fire on
  // the very first negotiation -- that one is already handled explicitly
  // by startPeerConnection / the webrtc_offer listener below.
  const hasNegotiatedOnceRef = useRef(false);

  // Initialize call if outgoing
  useEffect(() => {
    if (!socket) return;

    const handleRinging = ({ callId }) => {
      setCallId(callId);
      setStatus('ringing');
    };

    const handleConnected = () => {
      setStatus('connected');
      startPeerConnection();
    };

    const handleRejected = () => {
      setStatus('ended');
      cleanupCall();
      setTimeout(() => onEnd?.(), 1000);
    };

    const handleEnded = () => {
      setStatus('ended');
      cleanupCall();
      setTimeout(() => onEnd?.(), 1000);
    };

    socket.on('call_ringing', handleRinging);
    socket.on('call_connected', handleConnected);
    socket.on('call_rejected', handleRejected);
    socket.on('call_ended', handleEnded);

    // WebRTC Signaling listeners
    socket.on('webrtc_offer', async ({ sdp }) => {
      try {
        if (!pcRef.current) await setupPeerConnection();
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: toUserId, sdp: answer });
        hasNegotiatedOnceRef.current = true;
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
      }
    });

    socket.on('webrtc_answer', async ({ sdp }) => {
      try {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } catch (err) {
        console.error('Error handling WebRTC answer:', err);
      }
    });

    socket.on('webrtc_ice_candidate', async ({ candidate }) => {
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    // If outgoing, initiate the call
    if (!isIncoming && toUserId) {
      socket.emit('call_initiate', { to: toUserId, type });
    }

    return () => {
      socket.off('call_ringing', handleRinging);
      socket.off('call_connected', handleConnected);
      socket.off('call_rejected', handleRejected);
      socket.off('call_ended', handleEnded);
      socket.off('webrtc_offer');
      socket.off('webrtc_answer');
      socket.off('webrtc_ice_candidate');
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [socket, isIncoming, toUserId]);

  // Handle Call connected duration timer
  useEffect(() => {
    if (status === 'connected') {
      durationIntervalRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [status]);

  // Acquire local media streams
  const acquireLocalMedia = async () => {
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? { width: 320, height: 240 } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.error('Error acquiring media streams:', err);
      return null;
    }
  };

  // Setup WebRTC PeerConnection
  const setupPeerConnection = async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const stream = localStreamRef.current || (await acquireLocalMedia());
    if (stream) {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', { to: toUserId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // ── Network reconnect handling ──────────────────────────────
    // 'disconnected' is usually a transient blip (wifi hiccup, network
    // switch) -- give it a chance to recover on its own before treating
    // the call as dead. 'failed' means it's not coming back.
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;

      if (state === 'disconnected') {
        setReconnecting(true);

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          // Still not back after the grace window -- give up.
          handleConnectionLost();
        }, 18000);

        try {
          pc.restartIce();
        } catch (err) {
          console.error('Failed to restart ICE:', err);
        }
      } else if (state === 'failed') {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        handleConnectionLost();
      } else if (state === 'connected' || state === 'completed') {
        // Either a fresh connection, or a recovery after 'disconnected'.
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        setReconnecting(false);
      }
    };

    // pc.restartIce() alone doesn't push anything over signaling -- it
    // just flags the connection so the NEXT offer includes fresh ICE
    // credentials. Only the original caller re-offers here, so both
    // sides don't race to send competing offers; the callee just waits
    // for that new offer via the existing webrtc_offer listener below,
    // exactly like the initial call setup.
    pc.onnegotiationneeded = async () => {
      if (!hasNegotiatedOnceRef.current || isIncoming) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit('webrtc_offer', { to: toUserId, sdp: offer });
      } catch (err) {
        console.error('Failed to renegotiate after ICE restart:', err);
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const startPeerConnection = async () => {
    try {
      await setupPeerConnection();
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socket?.emit('webrtc_offer', { to: toUserId, sdp: offer });
      hasNegotiatedOnceRef.current = true;
    } catch (err) {
      console.error('Failed to create WebRTC offer:', err);
    }
  };

  const handleAccept = async () => {
    if (!socket || !callId) return;
    setStatus('connected');
    await acquireLocalMedia();
    socket.emit('call_accept', { callId });
    await setupPeerConnection();
  };

  const handleDecline = () => {
    if (!socket || !callId) return;
    setStatus('ended');
    socket.emit('call_reject', { callId, reason: 'declined' });
    cleanupCall();
    setTimeout(() => onEnd?.(), 500);
  };

  const handleEnd = () => {
    if (!socket || !callId) return;
    setStatus('ended');
    socket.emit('call_end', { callId });
    cleanupCall();
    setTimeout(() => onEnd?.(), 500);
  };

  // The ICE connection has failed, or stayed 'disconnected' past the
  // recovery grace window -- this is a genuinely dead call, not a blip.
  // Show "Connection lost" for a moment, then reuse the exact same
  // hang-up path a normal "End Call" tap uses, rather than a separate
  // teardown routine.
  const handleConnectionLost = () => {
    setReconnecting(false);
    setConnectionLost(true);
    setTimeout(() => handleEnd(), 1500);
  };

  const cleanupCall = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  // Toggle Mic / Cam
  const toggleMic = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMicOn(track.enabled);
      }
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setCamOn(track.enabled);
      }
    }
  };

  const formatTime = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const cleanUsername = partnerUsername 
    ? (partnerUsername.startsWith('@') ? partnerUsername : `@${partnerUsername}`)
    : (partnerName ? `@${partnerName.toLowerCase().replace(/\s+/g, '')}` : '');

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-zinc-950/95 backdrop-blur-md select-none">
      {/* ── VIDEO CALL LAYOUT ──────────────────────────────────────── */}
      {type === 'video' ? (
        <div className="relative w-full h-full flex flex-col justify-between overflow-hidden">
          {/* Video Streams */}
          {status === 'connected' && (
            <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute top-20 right-6 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/80 shadow-2xl bg-zinc-900 z-30">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {/* Top Center Header: Pet Name & @Username */}
          <div className="relative z-20 pt-12 text-center px-6 space-y-1 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-10">
            <h2 className="text-2xl font-black tracking-tight text-white drop-shadow-md">{partnerName}</h2>
            {cleanUsername && (
              <p className="text-xs font-bold text-pink-300 drop-shadow-sm">{cleanUsername}</p>
            )}
            <p className={`text-xs font-bold tracking-widest uppercase pt-1 ${
              connectionLost ? 'text-rose-400' :
              reconnecting ? 'text-amber-400 animate-pulse' :
              status === 'ringing' || status === 'dialing' ? 'text-white/80 animate-pulse' :
              status === 'connected' ? 'text-emerald-400 font-bold' :
              'text-rose-400'
            }`}>
              {connectionLost ? '🐾 Connection lost' :
               reconnecting ? 'Reconnecting...' :
               status === 'dialing' ? 'Connecting...' :
               status === 'ringing' ? 'Ringing...' :
               status === 'connected' ? formatTime(duration) :
               'Call ended'}
            </p>
          </div>

          {/* Bottom Call Controls Bar */}
          <div className="relative z-20 pb-12 pt-6 px-6 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex flex-col items-center gap-4">
            {status === 'ringing' && isIncoming ? (
              <div className="flex gap-8 justify-center w-full">
                <button
                  onClick={handleDecline}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-rose-500 hover:bg-rose-600 shadow-lg active:scale-90 transition-transform"
                  title="Decline"
                >
                  <span className="material-symbols-outlined text-[28px]">call_end</span>
                </button>
                <button
                  onClick={handleAccept}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-emerald-500 hover:bg-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-90 transition-transform"
                  title="Accept"
                >
                  <span className="material-symbols-outlined text-[28px]">call</span>
                </button>
              </div>
            ) : (
              /* Video Call Controls: Camera, Speaker, Mute/Unmute, End Call */
              <div className="flex items-center justify-center gap-5 w-full">
                {/* 🎥 Camera On / Off */}
                <button
                  onClick={toggleCam}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 shadow-lg ${
                    camOn ? 'bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10' : 'bg-rose-500 hover:bg-rose-600'
                  }`}
                  title={camOn ? 'Camera Off' : 'Camera On'}
                >
                  <span className="material-symbols-outlined text-[24px]">{camOn ? 'videocam' : 'videocam_off'}</span>
                </button>

                {/* 🔊 Speaker */}
                <button
                  onClick={() => setSpeakerOn(s => !s)}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 shadow-lg ${
                    speakerOn ? 'bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10 text-emerald-300' : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                  title={speakerOn ? 'Speaker On' : 'Speaker Off'}
                >
                  <span className="material-symbols-outlined text-[24px]">{speakerOn ? 'volume_up' : 'volume_off'}</span>
                </button>

                {/* 🎤 Mute / Unmute */}
                <button
                  onClick={toggleMic}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 shadow-lg ${
                    micOn ? 'bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10' : 'bg-rose-500 hover:bg-rose-600'
                  }`}
                  title={micOn ? 'Mute' : 'Unmute'}
                >
                  <span className="material-symbols-outlined text-[24px]">{micOn ? 'mic' : 'mic_off'}</span>
                </button>

                {/* 📞 End Call */}
                <button
                  onClick={handleEnd}
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 bg-rose-500 hover:bg-rose-600 shadow-[0_4px_20px_rgba(244,63,94,0.4)]"
                  title="End Call"
                >
                  <span className="material-symbols-outlined text-[24px]">call_end</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── AUDIO CALL LAYOUT ──────────────────────────────────────── */
        <div className="flex flex-col items-center justify-between p-8 text-white text-center z-10 w-full max-w-sm h-[85vh]">
          {/* User Card */}
          <div className="flex flex-col items-center gap-5 mt-6">
            <div className="relative">
              <img
                src={partnerAvatar || '/logo.png'}
                alt={partnerName}
                className="w-32 h-32 rounded-full object-cover border-4 border-pink-400/40 z-10 relative shadow-2xl"
              />
              {(status === 'ringing' || status === 'dialing') && (
                <div className="absolute -inset-4 rounded-full border-2 border-pink-400/40 animate-[ping_1.5s_ease-in-out_infinite]" />
              )}
              {reconnecting && (
                <div className="absolute -inset-4 rounded-full border-2 border-amber-400/50 animate-[ping_1.5s_ease-in-out_infinite]" />
              )}
              {status === 'connected' && !reconnecting && !connectionLost && (
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-zinc-900 z-20">
                  <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                </div>
              )}
              {reconnecting && (
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center border-2 border-zinc-900 z-20 animate-spin">
                  <span className="material-symbols-outlined text-white text-sm">sync</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight text-white">{partnerName}</h2>
              {cleanUsername && (
                <p className="text-xs font-bold text-pink-300">{cleanUsername}</p>
              )}
              <p className={`text-xs font-bold tracking-widest uppercase pt-1 ${
                connectionLost ? 'text-rose-400' :
                reconnecting ? 'text-amber-400 animate-pulse' :
                status === 'ringing' || status === 'dialing' ? 'text-white/70 animate-pulse' :
                status === 'connected' ? 'text-emerald-400 font-bold' :
                'text-rose-400'
              }`}>
                {connectionLost ? '🐾 Connection lost' :
                 reconnecting ? 'Reconnecting...' :
                 status === 'dialing' ? 'Connecting...' :
                 status === 'ringing' ? 'Ringing...' :
                 status === 'connected' ? formatTime(duration) :
                 'Call ended'}
              </p>
            </div>
          </div>

          {/* Essential Audio Controls Bar */}
          <div className="flex flex-col gap-6 items-center w-full mb-4">
            {status === 'ringing' && isIncoming ? (
              <div className="flex gap-8 justify-center w-full">
                <button
                  onClick={handleDecline}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-rose-500 hover:bg-rose-600 shadow-lg active:scale-90 transition-transform"
                  title="Decline"
                >
                  <span className="material-symbols-outlined text-[28px]">call_end</span>
                </button>
                <button
                  onClick={handleAccept}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-emerald-500 hover:bg-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-90 transition-transform"
                  title="Accept"
                >
                  <span className="material-symbols-outlined text-[28px]">call</span>
                </button>
              </div>
            ) : (
              /* Audio Call Essential Controls: Speaker, Mute/Unmute, End Call */
              <div className="flex items-center justify-center gap-6 w-full">
                {/* 🔊 Speaker */}
                <button
                  onClick={() => setSpeakerOn(s => !s)}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 shadow-lg ${
                    speakerOn ? 'bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10 text-emerald-300' : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                  title={speakerOn ? 'Speaker On' : 'Speaker Off'}
                >
                  <span className="material-symbols-outlined text-[24px]">{speakerOn ? 'volume_up' : 'volume_off'}</span>
                </button>

                {/* 🎤 Mute / Unmute */}
                <button
                  onClick={toggleMic}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 shadow-lg ${
                    micOn ? 'bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10' : 'bg-rose-500 hover:bg-rose-600'
                  }`}
                  title={micOn ? 'Mute' : 'Unmute'}
                >
                  <span className="material-symbols-outlined text-[24px]">{micOn ? 'mic' : 'mic_off'}</span>
                </button>

                {/* 📞 End Call */}
                <button
                  onClick={handleEnd}
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-all active:scale-90 bg-rose-500 hover:bg-rose-600 shadow-[0_4px_20px_rgba(244,63,94,0.4)]"
                  title="End Call"
                >
                  <span className="material-symbols-outlined text-[24px]">call_end</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
