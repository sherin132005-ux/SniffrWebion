import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in this link.');
      return;
    }

    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setStatus('success');
        setMessage(res.message || 'Your email has been verified!');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message || 'This verification link is invalid or has expired.');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white dark:bg-zinc-900 border border-outline-variant/10 rounded-[2.5rem] p-8 shadow-xl text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-3xl">
          {status === 'verifying' && <span className="animate-spin">🐾</span>}
          {status === 'success' && <span>✅</span>}
          {status === 'error' && <span>⚠️</span>}
        </div>

        <div>
          <h1 className="font-extrabold text-lg text-on-surface">
            {status === 'verifying' && 'Verifying your email...'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </h1>
          <p className="text-sm text-zinc-500 font-medium mt-2">{message}</p>
        </div>

        {status !== 'verifying' && (
          <button
            onClick={() => navigate('/home')}
            className="w-full py-3 bg-gradient-to-r from-primary to-primary-fixed-dim text-white rounded-full font-bold text-xs uppercase tracking-widest shadow-md hover:opacity-90 transition-all active:scale-95"
          >
            Continue to Sniffr
          </button>
        )}

        {status === 'error' && (
          <p className="text-xs text-zinc-400">
            You can request a new verification email from your Settings once you're logged in.
          </p>
        )}
      </div>
    </div>
  );
}
