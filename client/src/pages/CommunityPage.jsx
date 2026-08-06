import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../services/api';
import UpsellModal from '../components/UpsellModal';
import { isPremiumGateError } from '../utils/premiumErrors';
import PremiumBadge from '../components/PremiumBadge';

// ─── Custom Voice Playback Component with Paw timeline ──────────
function VoicePlayer({ audioUrl }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  return (
    <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800 rounded-full px-4 py-2 border border-zinc-100 dark:border-zinc-800 max-w-[240px]">
      <audio ref={audioRef} src={audioUrl} className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-md active:scale-90 transition-transform flex-shrink-0"
      >
        <span className="material-symbols-outlined text-sm">{playing ? 'pause' : 'play_arrow'}</span>
      </button>
      
      {/* Progress timeline with animated smooth paw head */}
      <div className="flex-1 pr-2 min-w-[120px]">
        <div className="paw-playback-timeline w-full">
          <div className="paw-playback-progress animate-pulse" style={{ width: `${progress}%` }} />
          <div className="paw-playback-head text-primary drop-shadow-sm" style={{ left: `${progress}%` }}>🐾</div>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getSocket } = useSocket();

  const [community, setCommunity] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('chat'); // chat is default landing
  const [inviteToast, setInviteToast] = useState(null);
  const [upsell, setUpsell] = useState(null); // { title, message } -- premium upsell modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);

  // Retract (Leave) state
  const [showRetractModal, setShowRetractModal] = useState(false);
  const [retracting, setRetracting] = useState(false);

  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Inappropriate Content');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Disable (Creator Only) state
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [disablingCommunity, setDisablingCommunity] = useState(false);

  const handleDeleteGroup = async () => {
    setDeletingGroup(true);
    try {
      await api.post(`/communities/${id}/delete-group`);
      setInviteToast('PawCircle conversation deleted.');
      setTimeout(() => {
        navigate('/chat?tab=pawcircle');
      }, 800);
    } catch (err) {
      console.error(err);
      alert('Failed to delete PawCircle conversation.');
    } finally {
      setDeletingGroup(false);
      setShowDeleteModal(false);
    }
  };

  const handleRetractCommunity = async () => {
    setRetracting(true);
    try {
      await api.post(`/communities/${id}/leave`);
      setInviteToast('Retracted from PawCircle.');
      setTimeout(() => navigate('/chat?tab=pawcircle'), 800);
    } catch (err) {
      console.error(err);
      alert('Failed to retract from PawCircle.');
    } finally {
      setRetracting(false);
      setShowRetractModal(false);
    }
  };

  const handleReportCommunity = async (e) => {
    e.preventDefault();
    setSubmittingReport(true);
    try {
      await api.post(`/communities/${id}/report`, { reason: reportReason, details: reportDetails });
      
      // Save report to localStorage so it appears in Me -> Settings -> Report History
      const newReport = {
        id: 'rep_' + Date.now(),
        reason: reportReason,
        post_reference: `PawCircle Community: ${community?.name || 'Circle'}`,
        description: `Reported PawCircle "${community?.name || 'Circle'}" for: ${reportReason}${reportDetails ? ` - ${reportDetails}` : ''}`,
        date: new Date().toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        status: 'Pending'
      };
      const saved = JSON.parse(localStorage.getItem('sniffr_user_reports') || '[]');
      localStorage.setItem('sniffr_user_reports', JSON.stringify([newReport, ...saved]));

      setInviteToast('Report submitted successfully.');
      setShowReportModal(false);
      setReportDetails('');
    } catch (err) {
      console.error(err);
      alert('Failed to submit report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDisableCommunity = async () => {
    setDisablingCommunity(true);
    try {
      await api.post(`/communities/${id}/disable`);
      setInviteToast('PawCircle disabled.');
      setTimeout(() => navigate('/chat?tab=pawcircle'), 800);
    } catch (err) {
      console.error(err);
      alert('Failed to disable PawCircle.');
    } finally {
      setDisablingCommunity(false);
      setShowDisableModal(false);
    }
  };

  useEffect(() => {
    if (location.state?.announcementId || location.state?.eventId) {
      setActiveSubTab('announcements');
    }
  }, [location.state]);

  const [loading, setLoading] = useState(true);

  // Sub-data inside community
  const [announcements, setAnnouncements] = useState([]);
  const [messages, setMessages] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [files, setFiles] = useState([]);
  const [polls, setPolls] = useState([]);
  const [members, setMembers] = useState([]);

  const handleCopyInviteLink = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const commId = community?.id || id;
    if (!commId) return;
    const inviteUrl = `${window.location.origin}/community/${commId}?invite=true`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inviteUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = inviteUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch (err) {
      console.error('Clipboard copy error:', err);
    }

    setInviteToast('PawCircle link copied successfully.');
    setTimeout(() => setInviteToast(null), 2500);
  };

  // Input states
  const [newMsg, setNewMsg] = useState('');
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [showAnnForm, setShowAnnForm] = useState(false);

  const [isEventAnnouncement, setIsEventAnnouncement] = useState(false);
  const [eventLocationQuery, setEventLocationQuery] = useState('');
  const [eventLocationResults, setEventLocationResults] = useState([]);
  const [eventLocationSearching, setEventLocationSearching] = useState(false);
  const [selectedEventLocation, setSelectedEventLocation] = useState(null);

  // Poll create states
  const [showPollForm, setShowPollForm] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollAnonymous, setPollAnonymous] = useState(false);

  const chatBottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadCommunityDetails();
  }, [id]);

  // Socket.IO event registrations
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('join_community_chat', { communityId: parseInt(id) });

    const onMessage = (msg) => {
      if (msg.community_id === parseInt(id)) {
        setMessages(prev => {
          const exists = prev.some(m => m.id === msg.id);
          if (exists) return prev;
          return [...prev, msg];
        });
        if (msg.message_type === 'file') {
          setFiles(prev => [...prev, msg]);
        }
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    };

    // Member rows store the pet's name/avatar denormalized (pet_name,
    // pet_avatar) rather than a live reference -- match on user_id since
    // that's the actual relational key on a community_members row (there's
    // no pet_id on the member row itself).
    const onProfileUpdated = ({ pet: updatedPet }) => {
      if (!updatedPet || updatedPet.user_id == null) return;
      setMembers(prev => prev.map(m => (
        m.user_id === updatedPet.user_id
          ? { ...m, pet_name: updatedPet.name, pet_avatar: updatedPet.avatar_url, is_premium: updatedPet.is_premium }
          : m
      )));
    };

    socket.on('community_message_received', onMessage);
    socket.on('profile_updated', onProfileUpdated);

    return () => {
      socket.off('community_message_received', onMessage);
      socket.off('profile_updated', onProfileUpdated);
      socket.emit('leave_community_chat', { communityId: parseInt(id) });
    };
  }, [id, getSocket]);

  const loadCommunityDetails = async () => {
    setLoading(true);
    const cleanId = parseInt(String(id || '').replace(/\D+/g, ''), 10) || 1;
    try {
      const res = await api.get(`/communities/${cleanId}`);
      if (!res.community) {
        setCommunity(null);
        setLoading(false);
        return;
      }
      setCommunity(res.community);

      // Check if opened via unique invite link (?invite=true)
      const query = new URLSearchParams(location.search);
      const isInvite = query.get('invite') === 'true';

      if (location.state?.announcementId || location.state?.eventId || location.state?.openAnnouncements) {
        setActiveSubTab('announcements');
      } else if (isInvite) {
        if (res.community.joinStatus === 'Joined') {
          setActiveSubTab('chat');
        } else {
          setActiveSubTab('details');
        }
      } else if (res.community.joinStatus !== 'Joined') {
        setActiveSubTab('details');
      } else {
        setActiveSubTab('chat');
      }

      // These content endpoints now correctly 403 for non-members (server-side
      // membership check). A non-member is still allowed to see this page's
      // public info (already set via setCommunity above) -- so each call is
      // individually swallowed here rather than left to reject the whole
      // Promise.all, which would otherwise hit the catch block below and
      // wipe community back to null even though the public fetch succeeded.
      const [annRes, msgRes, photoRes, pollRes, memRes] = await Promise.all([
        api.get(`/communities/${cleanId}/announcements`).catch(() => ({})),
        api.get(`/communities/${cleanId}/messages`).catch(() => ({})),
        api.get(`/communities/${cleanId}/photos`).catch(() => ({})),
        api.get(`/communities/${cleanId}/polls`).catch(() => ({})),
        api.get(`/communities/${cleanId}/members`).catch(() => ({}))
      ]);

      setAnnouncements(annRes.announcements || []);
      setMessages(msgRes.messages || []);
      setPhotos(photoRes.photos || []);
      setPolls(pollRes.polls || []);
      setMembers(memRes.members || []);

      const fileMessages = (msgRes.messages || []).filter(m => m.message_type === 'file');
      setFiles(fileMessages);

      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      console.error(err);
      setCommunity(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMsg.trim()) return;
    try {
      await api.post(`/communities/${id}/messages`, { content: newMsg });
      setNewMsg('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleMediaUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('media', file);
    formData.append('content', file.name);

    try {
      // Check if file is image/video or arbitrary document
      const isImgVideo = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'].includes(file.type);
      const endpoint = isImgVideo 
        ? `/communities/${id}/messages` 
        : `/communities/${id}/messages`; // standard community message upload endpoint

      const res = await api.post(endpoint, formData);
      if (res && res.message) {
        // Emit socket message
        const socket = getSocket();
        socket?.emit('send_community_message', { communityId: parseInt(id), content: file.name, mediaUrl: res.message.media_url });
      }
      loadCommunityDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePostAnnouncement = async (e) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;

    // If marked as an event, require a chosen location
    if (isEventAnnouncement && !selectedEventLocation) {
      alert('Please search and select the event location, or turn off "Nearby Event".');
      return;
    }

    try {
      const res = await api.post(`/communities/${id}/announcements`, {
        title: annTitle,
        content: annContent,
        is_event: isEventAnnouncement ? 1 : 0,
        latitude: isEventAnnouncement ? selectedEventLocation.lat : null,
        longitude: isEventAnnouncement ? selectedEventLocation.lng : null,
      });
      setAnnouncements(prev => [res.announcement, ...prev].slice(0, 3));
      setAnnTitle('');
      setAnnContent('');
      setIsEventAnnouncement(false);
      setEventLocationQuery('');
      setEventLocationResults([]);
      setSelectedEventLocation(null);
      setShowAnnForm(false);

      // Auto-insert system message notify
      await api.post(`/communities/${id}/messages`, {
        content: `📣 Announcement Pinned: ${annTitle}`,
        message_type: 'system'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleEventLocationSearch = async (query) => {
    setEventLocationQuery(query);
    setSelectedEventLocation(null);
    if (!query.trim() || query.trim().length < 3) {
      setEventLocationResults([]);
      return;
    }
    setEventLocationSearching(true);
    try {
      const res = await api.get(`/profile/places-autocomplete?q=${encodeURIComponent(query)}`);
      setEventLocationResults(res.results || []);
    } catch (err) {
      console.error('Places autocomplete failed:', err);
      setEventLocationResults([]);
    } finally {
      setEventLocationSearching(false);
    }
  };

  const handleSelectEventLocation = async (prediction) => {
    setEventLocationResults([]);
    setEventLocationQuery(prediction.display_name);
    try {
      const res = await api.get(`/profile/place-details?place_id=${encodeURIComponent(prediction.place_id)}`);
      if (res && res.lat != null && res.lng != null) {
        setSelectedEventLocation({ display_name: res.display_name || prediction.display_name, lat: res.lat, lng: res.lng });
      } else {
        alert('Could not get exact location for that place. Please try another result.');
      }
    } catch (err) {
      console.error('Place details lookup failed:', err);
      alert('Could not get exact location for that place. Please try another result.');
    }
  };

  const addPollOption = () => setPollOptions(p => [...p, '']);
  const updatePollOption = (idx, val) => {
    const next = [...pollOptions];
    next[idx] = val;
    setPollOptions(next);
  };

  const handleCreatePoll = async (e) => {
    e.preventDefault();
    const opts = pollOptions.filter(o => o.trim());
    if (!pollQuestion.trim() || opts.length < 2) return;

    try {
      const res = await api.post(`/communities/${id}/polls`, {
        question: pollQuestion,
        options: opts,
        isAnonymous: pollAnonymous ? 1 : 0
      });
      setPolls(prev => [res.poll, ...prev]);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollAnonymous(false);
      setShowPollForm(false);

      await api.post(`/communities/${id}/messages`, {
        content: `📊 New Pack Poll: ${pollQuestion}`,
        message_type: 'system'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleVote = async (pollId, optIdx) => {
    try {
      const res = await api.post(`/communities/${id}/polls/${pollId}/vote`, {
        optionIndex: optIdx
      });
      setPolls(prev => prev.map(p => p.id === pollId ? res.poll : p));
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateRole = async (targetUserId, newRole) => {
    try {
      await api.post(`/communities/${id}/members/${targetUserId}/role`, { role: newRole });
      const memRes = await api.get(`/communities/${id}/members`);
      setMembers(memRes.members || []);
      const detailRes = await api.get(`/communities/${id}`);
      setCommunity(detailRes.community);
    } catch (err) {
      alert('Role assignment permission denied!');
    }
  };

  const renderCommunityBadges = (comm) => {
    const list = [];
    if (comm.verified) {
      list.push(
        <span key="v" className="material-symbols-outlined text-[14px] text-sky-500" title="Verified Community">
          verified
        </span>
      );
    }
    if ((comm.member_count || 0) >= 100) {
      list.push(
        <span key="t" className="material-symbols-outlined text-[14px] text-yellow-500" title="Top PawCircle">
          military_tech
        </span>
      );
    }
    const nameLower = (comm.name || '').toLowerCase();
    if (nameLower.includes('golden') || nameLower.includes('retriever')) {
      list.push(<span key="b" className="text-xs" title="Golden Retriever Club">🐶</span>);
    } else if (nameLower.includes('cat') || nameLower.includes('persian') || nameLower.includes('rescue')) {
      list.push(<span key="c" className="text-xs" title="Cat rescue / Breed">🐱</span>);
    }

    if (list.length === 0) return null;
    return <div className="flex items-center gap-1 ml-1">{list}</div>;
  };

  if (loading) {
    return (
      <div className="bg-surface min-h-screen pt-24 lg:pt-8 px-4 lg:px-8 text-center animate-pulse max-w-lg mx-auto">
        <div className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded-2xl mb-8" />
        <div className="h-[400px] bg-zinc-50 dark:bg-zinc-800 rounded-[2.5rem]" />
      </div>
    );
  }

  if (!community) {
    return (
      <div className="bg-surface min-h-screen pt-24 px-6 text-center max-w-md mx-auto flex flex-col items-center justify-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center text-3xl shadow-sm">
          🐾
        </div>
        <h2 className="text-lg font-extrabold text-on-surface">PawCircle Unavailable</h2>
        <p className="text-xs text-zinc-500">This PawCircle could not be found or has been moved.</p>
        <button
          onClick={() => navigate('/chat?tab=pawcircle')}
          className="px-6 py-3 bg-primary text-white font-extrabold text-xs rounded-full shadow-md active:scale-95 transition-all"
        >
          Explore PawCircles
        </button>
      </div>
    );
  }

  const isMember = community.joinStatus === 'Joined';
  const isOwner = community.userRole === 'Owner';
  const isAdmin = community.userRole === 'Admin';
  const canManage = isOwner || isAdmin;

  const handleJoin = async () => {
    try {
      const res = await api.post(`/communities/${id}/join`);
      setCommunity(res.community);
      // Reload details
      loadCommunityDetails();
    } catch (err) {
      if (isPremiumGateError(err)) {
        setUpsell({ title: 'PawCircle Limit Reached', message: err.message });
      } else {
        console.error(err);
      }
    }
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen pt-24 lg:pt-8 px-4 lg:px-8 text-left max-w-lg mx-auto pb-24 animate-slide-up">
      {/* Standard Navigation Header */}
      <header className="flex items-center justify-between py-4 border-b border-outline-variant/10 mb-6">
        <button
          onClick={() => {
            if (activeSubTab !== 'chat' && isMember) {
              setActiveSubTab('chat');
            } else {
              navigate('/chat?tab=pawcircle');
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-primary transition-colors text-xs font-bold uppercase tracking-widest active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Back
        </button>
        <div className="text-center">
          <h2 className="text-sm font-extrabold tracking-widest uppercase text-on-surface flex items-center justify-center">
            {community.name}
            {renderCommunityBadges(community)}
          </h2>
          <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5">
            {community.member_count} Members • {community.activeMembersCount || 2} Active Today
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowOptionsMenu(!showOptionsMenu)}
            className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-primary active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-sm">more_vert</span>
          </button>

          {showOptionsMenu && (
            <div className="absolute right-0 top-10 z-50 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-outline-variant/20 py-2 w-52 animate-scale-up text-left overflow-hidden">
              <button
                onClick={() => { setShowOptionsMenu(false); setActiveSubTab('details'); }}
                className="w-full px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm text-zinc-400">info</span>
                <span>Info & Rules</span>
              </button>

              {isMember && (
                <button
                  onClick={() => { setShowOptionsMenu(false); setShowDeleteModal(true); }}
                  className="w-full px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-zinc-400">delete</span>
                  <span>Delete Group</span>
                </button>
              )}

              {isMember && (
                <button
                  onClick={() => { setShowOptionsMenu(false); setShowRetractModal(true); }}
                  className="w-full px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-zinc-400">logout</span>
                  <span>Retract</span>
                </button>
              )}

              <button
                onClick={() => { setShowOptionsMenu(false); setShowReportModal(true); }}
                className="w-full px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm text-zinc-400">flag</span>
                <span>Report</span>
              </button>

              {/* Creator Only Option */}
              {(isOwner || community.created_by === user.id) && (
                <button
                  onClick={() => { setShowOptionsMenu(false); setShowDisableModal(true); }}
                  className="w-full px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2.5 border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-2 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">block</span>
                  <span>Disable PawCircle</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto no-scrollbar py-2 gap-1.5 mb-6">
        {[
          { id: 'chat', label: '💬 Chat', disabled: !isMember },
          { id: 'announcements', label: '📣 Pinned', disabled: !isMember },
          { id: 'media', label: '🖼 Media', disabled: !isMember },
          { id: 'files', label: '📁 Files', disabled: !isMember },
          { id: 'polls', label: '📊 Polls', disabled: !isMember },
          { id: 'members', label: '👥 Members', disabled: !isMember },
          { id: 'details', label: 'ℹ Info' }
        ].map(tab => (
          <button
            key={tab.id}
            disabled={tab.disabled}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex-shrink-0
              ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}
              ${activeSubTab === tab.id ? 'bg-primary text-white shadow-sm shadow-primary/20' : 'text-zinc-400 hover:bg-zinc-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-6 shadow-sm border border-outline-variant/10 min-h-[460px]">
        {/* Chat tab (default view) */}
        {activeSubTab === 'chat' && isMember && (
          <div className="flex flex-col h-[460px] justify-between">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 no-scrollbar mb-4">
              {/* announcements inside chat stream */}
              {announcements.slice(0, 1).map(ann => (
                <div key={ann.id} className="bg-yellow-50 border border-yellow-100 rounded-2xl p-3 flex gap-2 items-start text-left shadow-sm">
                  <span className="material-symbols-outlined text-yellow-600 text-lg">campaign</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-yellow-800 uppercase tracking-widest">Pinned Announcement</p>
                    <p className="text-[11px] font-bold text-yellow-900 mt-0.5 truncate">{ann.title}</p>
                    <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5 line-clamp-2">{ann.content}</p>
                  </div>
                </div>
              ))}

              {messages.map((msg, i) => {
                const isOwn = msg.sender_id === user.id;
                const isSystem = msg.message_type === 'system';

                if (isSystem) {
                  return (
                    <div key={msg.id || i} className="text-center my-3">
                      <span className="inline-block bg-zinc-100 dark:bg-zinc-800 text-[10px] font-black tracking-wider text-zinc-500 uppercase px-4 py-1.5 rounded-full border border-zinc-200/20">
                        {msg.content}
                      </span>
                    </div>
                  );
                }

                if (msg.message_type === 'voice') {
                  return (
                    <div key={msg.id || i} className={`flex gap-2 items-start ${isOwn ? 'justify-end ml-auto max-w-[80%]' : 'max-w-[80%]'}`}>
                      {!isOwn && (
                        <img className="w-8 h-8 rounded-full object-cover shadow-sm mt-1" src={msg.sender_avatar || '/logo.png'} alt={msg.pet_name} />
                      )}
                      <div>
                        {!isOwn && (
                          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-2 mb-0.5 block">{msg.pet_name || msg.username}</span>
                        )}
                        <VoicePlayer audioUrl={msg.media_url} />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id || i} className={`flex gap-2 items-start ${isOwn ? 'justify-end ml-auto max-w-[80%]' : 'max-w-[80%]'}`}>
                    {!isOwn && (
                      <img className="w-8 h-8 rounded-full object-cover shadow-sm mt-1" src={msg.sender_avatar || '/logo.png'} alt={msg.pet_name} />
                    )}
                    <div>
                      {!isOwn && (
                        <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-2 mb-0.5 block">{msg.pet_name || msg.username}</span>
                      )}
                      <div className={`px-4 py-2.5 text-xs leading-relaxed shadow-sm rounded-3xl
                        ${isOwn ? 'bg-primary text-white rounded-tr-sm' : 'bg-zinc-50 dark:bg-zinc-800 text-on-surface border border-outline-variant/10 rounded-tl-sm'}`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatBottomRef} />
            </div>

            {/* Input area */}
            <form onSubmit={handleSendMessage} className="flex gap-2 items-center bg-zinc-50 dark:bg-zinc-800 p-2 rounded-full border">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-zinc-400 hover:text-primary transition-colors ml-2"
                title="Attach Document / Media"
              >
                <span className="material-symbols-outlined text-lg">attach_file</span>
              </button>
              <input type="file" ref={fileInputRef} className="hidden" onChange={handleMediaUpload} />

              <input
                type="text"
                placeholder="Send to the Pack..."
                className="flex-1 bg-transparent border-none text-xs focus:ring-0 px-3 outline-none text-on-surface"
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
              />
              <button type="submit" disabled={!newMsg.trim()} className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95 disabled:opacity-40">
                <span className="material-symbols-outlined text-sm">send</span>
              </button>
            </form>
          </div>
        )}

        {/* Announcements */}
        {activeSubTab === 'announcements' && (
          <div className="space-y-4">
            {location.state?.isExpired && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl p-3.5 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2 mb-2 shadow-xs">
                <span className="text-base">⏳</span>
                <span>This event has already ended. Keep an eye on PawCircle for upcoming meetups! 🐾</span>
              </div>
            )}
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-extrabold text-sm uppercase tracking-wider text-zinc-400">Pack Announcements</h4>
              {canManage && (
                <button onClick={() => setShowAnnForm(!showAnnForm)} className="text-xs font-bold text-primary flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">add</span> Add Pinned
                </button>
              )}
            </div>

            {showAnnForm && (
              <form onSubmit={handlePostAnnouncement} className="bg-zinc-50 dark:bg-zinc-800 rounded-3xl p-4 border border-outline-variant/10 space-y-3 mb-4">
                <input
                  type="text"
                  required
                  placeholder="Announcement Title"
                  className="w-full bg-white dark:bg-zinc-900 border-none rounded-xl py-2 px-4 text-xs font-bold text-on-surface"
                  value={annTitle}
                  onChange={e => setAnnTitle(e.target.value)}
                />
                <textarea
                  required
                  rows={2}
                  placeholder="Content body..."
                  className="w-full bg-white dark:bg-zinc-900 border-none rounded-xl py-2 px-4 text-xs resize-none text-on-surface"
                  value={annContent}
                  onChange={e => setAnnContent(e.target.value)}
                />

                {/* 📍 Nearby Event toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none px-1">
                  <input
                    type="checkbox"
                    checked={isEventAnnouncement}
                    onChange={e => {
                      setIsEventAnnouncement(e.target.checked);
                      if (!e.target.checked) {
                        setEventLocationQuery('');
                        setEventLocationResults([]);
                        setSelectedEventLocation(null);
                      }
                    }}
                    className="accent-primary w-4 h-4"
                  />
                  <span className="text-[11px] font-bold text-on-surface">📍 Make this a Nearby Event</span>
                </label>
                <p className="text-[9px] text-zinc-400 font-medium px-1 -mt-1">
                  Pet parents within 20km of the event location who aren't in this PawCircle will be notified.
                </p>

                {/* Location search (only when event toggle is on) */}
                {isEventAnnouncement && (
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search event location (e.g. Cubbon Park, Bangalore)"
                        className="w-full bg-white dark:bg-zinc-900 border border-primary/20 rounded-xl py-2 px-4 text-xs text-on-surface"
                        value={eventLocationQuery}
                        onChange={e => handleEventLocationSearch(e.target.value)}
                      />
                      {eventLocationSearching && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>

                    {/* Selected location confirmation */}
                    {selectedEventLocation && (
                      <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
                        <span className="material-symbols-outlined text-emerald-500 text-sm">check_circle</span>
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 truncate flex-1">{selectedEventLocation.display_name}</span>
                        <button
                          type="button"
                          onClick={() => { setSelectedEventLocation(null); setEventLocationQuery(''); setEventLocationResults([]); }}
                          className="text-emerald-500 hover:text-red-500"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    )}

                    {/* Search results dropdown */}
                    {!selectedEventLocation && eventLocationResults.length > 0 && (
                      <div className="bg-white dark:bg-zinc-900 border border-outline-variant/15 rounded-xl overflow-hidden max-h-40 overflow-y-auto no-scrollbar">
                        {eventLocationResults.map((r, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSelectEventLocation(r)}
                            className="w-full text-left px-3 py-2 text-[10px] font-medium text-on-surface hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-outline-variant/5 last:border-0 flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-primary text-sm">location_on</span>
                            <span className="truncate">{r.display_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowAnnForm(false)} className="px-3 py-1.5 bg-zinc-200 text-[10px] font-bold rounded-lg uppercase">Cancel</button>
                  <button type="submit" className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg uppercase">Post Pinned</button>
                </div>
              </form>
            )}
            {announcements.length === 0 ? (
              <p className="text-xs text-zinc-400 italic text-center py-8">No pinned announcements yet.</p>
            ) : (
              <div className="space-y-3">
                {announcements.map(ann => (
                  <div key={ann.id} className="bg-yellow-50/50 border border-yellow-200/60 rounded-3xl p-4 relative shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <img className="w-6 h-6 rounded-full object-cover" src={ann.sender_avatar || '/logo.png'} alt={ann.username} />
                      <span className="text-[10px] font-black text-yellow-800 uppercase tracking-widest">{ann.full_name || ann.username}</span>
                      <span className="text-[8px] text-zinc-300 ml-auto">{new Date(ann.created_at).toLocaleDateString()}</span>
                    </div>
                    <h5 className="font-extrabold text-xs text-yellow-900 mb-1">{ann.title}</h5>
                    <p className="text-[11px] leading-relaxed text-zinc-600 font-medium">{ann.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Media */}
        {activeSubTab === 'media' && (
          <div className="space-y-4">
            <h4 className="font-extrabold text-sm uppercase tracking-wider text-zinc-400 mb-2">Shared Photos & Videos</h4>
            {photos.length === 0 ? (
              <p className="text-xs text-zinc-400 italic text-center py-8">No shared media yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map(p => (
                  <div key={p.id} className="aspect-square bg-zinc-100 rounded-xl overflow-hidden shadow-sm relative group cursor-pointer hover:scale-98 transition-transform">
                    <img src={p.media_url} alt="Shared" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Files */}
        {activeSubTab === 'files' && (
          <div className="space-y-4">
            <h4 className="font-extrabold text-sm uppercase tracking-wider text-zinc-400 mb-2">Shared Documents</h4>
            {files.length === 0 ? (
              <p className="text-xs text-zinc-400 italic text-center py-8">No files shared yet.</p>
            ) : (
              <div className="space-y-2">
                {files.map(f => (
                  <a key={f.id} href={f.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 bg-white border rounded-2xl hover:bg-zinc-50">
                    <span className="material-symbols-outlined text-primary text-xl">description</span>
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-xs font-bold text-on-surface truncate">{f.content || 'Document'}</p>
                      <p className="text-[9px] text-zinc-400">Shared by {f.pet_name}</p>
                    </div>
                    <span className="material-symbols-outlined text-zinc-400 text-sm">download</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Polls */}
        {activeSubTab === 'polls' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-extrabold text-sm uppercase tracking-wider text-zinc-400">🐾 Pack Polls</h4>
              <button onClick={() => setShowPollForm(!showPollForm)} className="text-xs font-bold text-primary flex items-center gap-0.5">
                <span className="material-symbols-outlined text-sm">add</span> Create Poll
              </button>
            </div>

            {showPollForm && (
              <form onSubmit={handleCreatePoll} className="bg-zinc-50 dark:bg-zinc-800 rounded-3xl p-4 border space-y-3 mb-4 text-left">
                <input
                  type="text"
                  required
                  placeholder="Ask a question..."
                  className="w-full bg-white dark:bg-zinc-950 border-none rounded-xl py-2 px-4 text-xs font-bold text-on-surface"
                  value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)}
                />
                {pollOptions.map((opt, i) => (
                  <input
                    key={i}
                    type="text"
                    required
                    placeholder={`Option ${i + 1}`}
                    className="w-full bg-white dark:bg-zinc-955 border-none rounded-xl py-1.5 px-4 text-xs text-on-surface"
                    value={opt}
                    onChange={e => updatePollOption(i, e.target.value)}
                  />
                ))}
                <button type="button" onClick={addPollOption} className="text-[10px] font-bold text-primary flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-xs">add</span> Add Option
                </button>
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input type="checkbox" checked={pollAnonymous} onChange={e => setPollAnonymous(e.target.checked)} className="rounded text-primary focus:ring-primary/20" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Anonymous Poll</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowPollForm(false)} className="px-3 py-1.5 bg-zinc-200 text-[10px] font-bold rounded-lg uppercase">Cancel</button>
                  <button type="submit" className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg uppercase">Create Poll</button>
                </div>
              </form>
            )}

            {polls.length === 0 ? (
              <p className="text-xs text-zinc-400 italic text-center py-8">No pack polls active.</p>
            ) : (
              <div className="space-y-4">
                {polls.map(poll => {
                  const totalVotes = Object.values(poll.votes || {}).reduce((acc, curr) => acc + (curr?.length || 0), 0);
                  return (
                    <div key={poll.id} className="bg-white dark:bg-zinc-950 border rounded-3xl p-4 shadow-sm text-left">
                      <h5 className="font-extrabold text-xs text-on-surface mb-2">{poll.question}</h5>
                      {poll.options.map((opt, optIdx) => {
                        const optionVotesList = poll.votes?.[optIdx] || [];
                        const optCount = optionVotesList.length;
                        const percent = totalVotes > 0 ? Math.round((optCount / totalVotes) * 100) : 0;
                        const voted = optionVotesList.includes(user.id);

                        return (
                          <button
                            key={optIdx}
                            onClick={() => handleVote(poll.id, optIdx)}
                            className="w-full block relative rounded-xl p-3 border mb-2 text-left hover:bg-zinc-50 transition-colors overflow-hidden group select-none"
                          >
                            <div className="absolute inset-0 bg-primary/5 transition-all" style={{ width: `${percent}%` }} />
                            <div className="relative flex justify-between items-center text-[11px] font-bold">
                              <span className={voted ? 'text-primary font-black' : 'text-zinc-600'}>{opt}</span>
                              <span className="text-zinc-400">{percent}% ({optCount})</span>
                            </div>
                          </button>
                        );
                      })}
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-3">
                        Total Votes: {totalVotes} • {poll.creator_name ? `Asked by @${poll.creator_name}` : 'Pack Poll'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Members */}
        {activeSubTab === 'members' && (
          <div className="space-y-4">
            <h4 className="font-extrabold text-sm uppercase tracking-wider text-zinc-400 mb-2">Pack Members</h4>
            <div className="space-y-2">
              {members.map(member => {
                const roleColors = { Owner: 'bg-yellow-100 text-yellow-800 border-yellow-200', Admin: 'bg-sky-100 text-sky-800 border-sky-200', Moderator: 'bg-purple-100 text-purple-800 border-purple-200', Member: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
                return (
                  <div key={member.id} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-950 border rounded-2xl">
                    <div className="flex items-center gap-3">
                      <img className="w-10 h-10 rounded-full object-cover" src={member.pet_avatar || '/logo.png'} alt={member.pet_name} />
                      <div>
                        <h5 className="font-bold text-xs text-on-surface flex items-center gap-1.5">
                          <span>{member.pet_name || member.username}</span>
                          <PremiumBadge pet={member} size="text-sm" />
                        </h5>
                        <p className="text-[9px] text-zinc-400">@{member.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${roleColors[member.role] || roleColors.Member}`}>
                        {member.role}
                      </span>
                      {canManage && member.user_id !== user.id && (
                        <select
                          className="bg-zinc-50 border border-zinc-200 rounded-lg text-[9px] font-bold p-1 text-on-surface"
                          value={member.role}
                          onChange={(e) => handleUpdateRole(member.user_id, e.target.value)}
                        >
                          {isOwner && <option value="Admin">Make Admin</option>}
                          <option value="Moderator">Make Moderator</option>
                          <option value="Member">Make Member</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Info / details profile */}
        {activeSubTab === 'details' && (
          <div className="space-y-5 text-left">
            <div className="flex flex-col items-center pb-4 border-b">
              <img className="w-24 h-24 rounded-3xl object-cover shadow-md mb-3" src={community.cover_image || '/logo.png'} alt={community.name} />
              <h4 className="font-black text-xl text-on-surface text-center flex items-center">
                {community.name}
                {renderCommunityBadges(community)}
              </h4>
              <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-1">Category: {community.category}</p>
            </div>

            <div>
              <h5 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1 mb-1">About</h5>
              <p className="text-xs bg-zinc-50/50 p-4 rounded-2xl border text-zinc-600 leading-relaxed font-medium">
                {community.description || 'A community of pet owners.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-50/50 p-3 rounded-2xl border text-center">
                <p className="text-lg font-black text-on-surface">{community.member_count}</p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Members</p>
              </div>
              <div className="bg-zinc-50/50 p-3 rounded-2xl border text-center">
                <p className="text-xs font-black text-on-surface mt-1.5">{community.city}</p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">City</p>
              </div>
            </div>

            <div>
              <h5 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1 mb-1">Pack Rules</h5>
              <p className="text-[11px] bg-zinc-50/50 p-4 rounded-2xl border text-zinc-500 leading-relaxed font-medium whitespace-pre-line">
                {community.rules}
              </p>
            </div>

            <div className="flex justify-between items-center text-[10px] text-zinc-400 uppercase font-black pl-1 pt-3 border-t border-outline-variant/10 mt-4">
              <span>Created {community.created_at ? new Date(community.created_at).toLocaleDateString() : 'Recently'}</span>
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="flex items-center gap-1.5 text-primary hover:text-primary-fixed-dim font-black text-[11px] uppercase tracking-wider transition-all active:scale-95 cursor-pointer hover:underline z-10"
              >
                <span className="material-symbols-outlined text-sm">link</span>
                <span>Invite Companions</span>
              </button>
            </div>

            {!isMember && (
              <button
                onClick={handleJoin}
                className="w-full py-4 mt-6 rounded-full bg-gradient-to-r from-primary to-primary-fixed-dim text-white font-bold text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <span>🐾 Join the Pack</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete Group Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border border-outline-variant/20 text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 bg-rose-100 dark:bg-rose-950/50 text-rose-500 rounded-full flex items-center justify-center mx-auto text-2xl shadow-inner">
              <span className="material-symbols-outlined">delete</span>
            </div>
            <div>
              <h3 className="font-extrabold text-base text-on-surface">Delete Group?</h3>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed mt-1">
                This will clear this PawCircle conversation and remove it from your list. You will remain a member, and future messages will automatically restore the PawCircle.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-extrabold text-xs rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={deletingGroup}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-95 uppercase tracking-wider disabled:opacity-50 cursor-pointer"
              >
                {deletingGroup ? 'Deleting...' : 'Delete Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retract Confirmation Modal */}
      {showRetractModal && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border border-outline-variant/20 text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-950/50 text-amber-500 rounded-full flex items-center justify-center mx-auto text-2xl shadow-inner">
              <span className="material-symbols-outlined">logout</span>
            </div>
            <div>
              <h3 className="font-extrabold text-base text-on-surface">Retract from PawCircle?</h3>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed mt-1">
                You will leave this PawCircle completely and be removed from members. You can search and join again later.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRetractModal(false)}
                className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-extrabold text-xs rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRetractCommunity}
                disabled={retracting}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-95 uppercase tracking-wider disabled:opacity-50 cursor-pointer"
              >
                {retracting ? 'Retracting...' : 'Retract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report PawCircle Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border border-outline-variant/20 text-left space-y-4 animate-scale-up">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="font-extrabold text-sm text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-rose-500 text-lg">flag</span>
                Report PawCircle
              </h3>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <form onSubmit={handleReportCommunity} className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Reason</label>
                <select
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-on-surface"
                >
                  <option value="Inappropriate Content">Inappropriate Content</option>
                  <option value="Spam or Scam">Spam or Scam</option>
                  <option value="Harassment">Harassment</option>
                  <option value="Offensive Language">Offensive Language</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Details (Optional)</label>
                <textarea
                  rows={3}
                  value={reportDetails}
                  onChange={e => setReportDetails(e.target.value)}
                  placeholder="Describe why you are reporting this community..."
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl p-3 text-xs text-on-surface resize-none placeholder:text-zinc-400"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 py-2.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-extrabold text-xs rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-wider cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-95 uppercase tracking-wider disabled:opacity-50 cursor-pointer"
                >
                  {submittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disable PawCircle Modal (Creator Only) */}
      {showDisableModal && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border border-outline-variant/20 text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 bg-rose-100 dark:bg-rose-950/50 text-rose-500 rounded-full flex items-center justify-center mx-auto text-2xl shadow-inner">
              <span className="material-symbols-outlined">block</span>
            </div>
            <div>
              <h3 className="font-extrabold text-base text-on-surface">Disable PawCircle?</h3>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed mt-1">
                As the creator, disabling this PawCircle will archive it and make it unavailable for members.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDisableModal(false)}
                className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-extrabold text-xs rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisableCommunity}
                disabled={disablingCommunity}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-95 uppercase tracking-wider disabled:opacity-50 cursor-pointer"
              >
                {disablingCommunity ? 'Disabling...' : 'Disable PawCircle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Link Toast Confirmation */}
      {inviteToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[220] bg-zinc-900/90 text-white dark:bg-white/90 dark:text-zinc-900 px-5 py-2.5 rounded-full text-xs font-black shadow-xl animate-bounce flex items-center gap-2 pointer-events-none border border-white/20">
          <span className="text-primary text-sm">🐾</span>
          <span>{inviteToast}</span>
        </div>
      )}

      {upsell && (
        <UpsellModal title={upsell.title} message={upsell.message} onClose={() => setUpsell(null)} />
      )}
    </div>
  );
}
