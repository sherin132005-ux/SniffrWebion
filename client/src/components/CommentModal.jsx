import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';
import PremiumBadge from './PremiumBadge';

export default function CommentModal({ postId, onClose, onCommentAdded }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // the comment being replied to (for the "Replying to @x" indicator)
  const inputRef = useRef(null);
  const scrollYRef = useRef(0);

  useEffect(() => {
    loadComments();

    // Save scroll position and lock scrolling
    scrollYRef.current = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // Trigger animation after mount
    requestAnimationFrame(() => setVisible(true));

    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollYRef.current);
    };
  }, [postId]);

  const loadComments = async () => {
    try {
      const data = await api.get(`/posts/${postId}/comments`);
      setComments(data.comments || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      // Flatten replies-to-replies to the top-level comment, same as the
      // backend's own normalization -- a thread never nests past 1 level.
      const parentCommentId = replyingTo ? (replyingTo.parent_comment_id || replyingTo.id) : null;
      const comment = await api.post(`/posts/${postId}/comment`, {
        content: newComment,
        ...(parentCommentId ? { parentCommentId } : {})
      });
      setComments(prev => [...prev, comment]);
      setNewComment('');
      setReplyingTo(null);
      if (onCommentAdded) onCommentAdded(postId);
    } catch (err) { console.error(err); }
    finally { setSubmitting(false); }
  };

  const handleReply = (comment) => {
    setReplyingTo(comment);
    inputRef.current?.focus();
  };

  // Group the flat comment list into top-level comments + their replies
  // (one level deep -- see PostRepository.addComment for why).
  const topLevelComments = comments.filter(c => !c.parent_comment_id);
  const repliesByParent = {};
  comments.forEach(c => {
    if (c.parent_comment_id) {
      if (!repliesByParent[c.parent_comment_id]) repliesByParent[c.parent_comment_id] = [];
      repliesByParent[c.parent_comment_id].push(c);
    }
  });

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onClose();
        }
      }}
      onTouchEnd={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {/* Comments Panel */}
      <div
        style={{
          backgroundColor: '#ffffff',
          width: '100%',
          maxWidth: '32rem',
          maxHeight: '80dvh',
          minHeight: '45dvh',
          borderTopLeftRadius: '2rem',
          borderTopRightRadius: '2rem',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px 16px 24px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#1a1a1a', letterSpacing: '-0.02em' }}>
            Comments
          </h2>
          <button
            onClick={onClose}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: '#f4f4f5',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '18px',
              color: '#71717a',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        {/* Comments list */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px',
          minHeight: 0,
        }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#f4f4f5', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ height: 12, backgroundColor: '#f4f4f5', borderRadius: 8, width: '33%' }} />
                    <div style={{ height: 12, backgroundColor: '#f4f4f5', borderRadius: 8, width: '66%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#e4e4e7', display: 'block', marginBottom: '12px' }}>chat_bubble</span>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>No comments yet</p>
              <p style={{ fontSize: '12px', color: '#d4d4d8', marginTop: '4px' }}>Be the first to leave a paw print! 🐾</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {topLevelComments.map((c) => (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Top-level comment */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <img
                    src={c.avatar_url || '/logo.png'}
                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(244,167,185,0.1)' }}
                    alt={c.username}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ backgroundColor: '#fafafa', borderRadius: '16px', borderTopLeftRadius: '4px', padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: '#1a1a1a' }}>@{c.username}</span>
                          <PremiumBadge pet={c} size="text-sm" />
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {new Date(c.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <p style={{ fontSize: '13px', color: '#52525b', lineHeight: 1.5, margin: 0 }}>{c.content}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleReply(c)}
                        style={{ background: 'none', border: 'none', padding: '4px 4px 0 4px', marginTop: '2px', fontSize: '11px', fontWeight: 700, color: '#a1a1aa', cursor: 'pointer' }}
                      >
                        Reply
                      </button>
                    </div>
                  </div>

                  {/* Replies -- nested/indented, smaller & secondary styling */}
                  {(repliesByParent[c.id] || []).map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginLeft: '36px' }}>
                      <img
                      src={r.avatar_url || '/logo.png'}
                      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(244,167,185,0.1)' }}
                      alt={r.username}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ backgroundColor: '#f4f4f5', borderRadius: '14px', borderTopLeftRadius: '4px', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                            <span style={{ fontWeight: 700, fontSize: '12px', color: '#3f3f46' }}>@{r.username}</span>
                            <PremiumBadge pet={r} size="text-sm" />
                            <span style={{ fontSize: '9px', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                              {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <p style={{ fontSize: '12px', color: '#71717a', lineHeight: 1.5, margin: 0 }}>{r.content}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleReply(r)}
                          style={{ background: 'none', border: 'none', padding: '4px 4px 0 4px', marginTop: '2px', fontSize: '10px', fontWeight: 700, color: '#a1a1aa', cursor: 'pointer' }}
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} style={{
          padding: '12px 24px 24px 24px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          {replyingTo && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: '#fafafa',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: '14px',
              padding: '8px 12px',
              marginBottom: '10px',
            }}>
              <div style={{ width: 3, height: 28, borderRadius: 999, backgroundColor: '#F4A7B9', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '10px', fontWeight: 800, color: '#F4A7B9', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                  🐾 Replying to @{replyingTo.username}
                </p>
                <p style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 500, margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {replyingTo.content}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#f4f4f5', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#71717a' }}>close</span>
              </button>
            </div>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: '#f4f4f5',
            borderRadius: '999px',
            padding: '8px 16px',
          }}>
            <input
              ref={inputRef}
              style={{
                flex: 1,
                backgroundColor: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '14px',
                color: '#1a1a1a',
                padding: '4px 0',
              }}
              placeholder={replyingTo ? `Reply to @${replyingTo.username}... 🐾` : 'Add a comment... 🐾'}
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
            />
            <button
              type="submit"
              disabled={submitting || !newComment.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: submitting || !newComment.trim() ? 'rgba(244,167,185,0.4)' : '#F4A7B9',
                color: 'white',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: submitting || !newComment.trim() ? 'default' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // Use React Portal to render outside the normal DOM tree
  // This ensures no parent CSS/positioning can interfere
  return createPortal(modalContent, document.body);
}
