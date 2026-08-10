import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useSocket } from './context/SocketContext';
import { CallProvider } from './context/CallContext';
import BottomNav, { SidebarNav } from './components/BottomNav';
import EmailVerifyBanner from './components/EmailVerifyBanner';
import WelcomeSlider from './components/WelcomeSlider';
import LoadingPage from './pages/LoadingPage';
import { lazy, Suspense } from 'react';

const AuthPage          = lazy(() => import('./pages/AuthPage'));
const PetSelectionPage  = lazy(() => import('./pages/PetSelectionPage'));
const CreateProfilePage = lazy(() => import('./pages/CreateProfilePage'));
const HomePage          = lazy(() => import('./pages/HomePage'));
const MeetPage          = lazy(() => import('./pages/MeetPage'));
const ChatPage          = lazy(() => import('./pages/ChatPage'));
const ProfilePage       = lazy(() => import('./pages/ProfilePage'));
const SpotlightPage     = lazy(() => import('./pages/SpotlightPage'));
const PrivacyPage       = lazy(() => import('./pages/PrivacyPage'));
const TermsPage         = lazy(() => import('./pages/TermsPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage   = lazy(() => import('./pages/VerifyEmailPage'));
const VerifyPawprintPage = lazy(() => import('./pages/VerifyPawprintPage'));
const CommunityPage     = lazy(() => import('./pages/CommunityPage'));
const CreateCommunityPage = lazy(() => import('./pages/CreateCommunityPage'));

function LoadingFallback() {
  return <LoadingPage />;
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const hasToken = !!localStorage.getItem('sniffr_refresh_token');

  if (loading) return <LoadingFallback />;
  if (!isAuthenticated && !hasToken) return <Navigate to="/" replace />;

  return children;
}

function CursorGlow() {
  const [pos, setPos] = useState({ x: -999, y: -999 });

  useEffect(() => {
    const move = (e) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  return (
    <div
      className="cursor-glow hidden lg:block"
      style={{ left: pos.x, top: pos.y }}
    />
  );
}

function BackgroundBlobs() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/8 blur-3xl animate-float-slow" />
      <div
        className="absolute top-1/3 -right-24 w-72 h-72 rounded-full bg-secondary/8 blur-3xl animate-float"
        style={{ animationDelay: '2s' }}
      />
      <div
        className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-tertiary/6 blur-3xl animate-float-slow"
        style={{ animationDelay: '4s' }}
      />
    </div>
  );
}

function MainLayout({ children }) {
  const location = useLocation();
  const { user, refreshProfile } = useAuth();
  const { socket } = useSocket();

  // Live update: if PawPrint gets enabled via the emailed link (e.g. opened
  // in another tab/device while this session stays open), reflect it here
  // immediately instead of waiting for the next manual refresh.
  useEffect(() => {
    if (!socket) return;
    const onPawprintEnabled = () => refreshProfile();
    socket.on('pawprint_enabled', onPawprintEnabled);
    return () => socket.off('pawprint_enabled', onPawprintEnabled);
  }, [socket, refreshProfile]);

  const showNav =
    ['/home', '/meet', '/chat', '/profile', '/spotlight'].includes(location.pathname) ||
    location.pathname.startsWith('/community');

  // Shown once per qualifying (first-100-signup) user, tracked by
  // welcome_slider_seen on the backend -- mounted here so it appears
  // regardless of which page they land on first after signup/login.
  const showWelcomeSlider = !!user?.is_founding_member && !user?.welcome_slider_seen;

  return (
    <div className="app-shell">
      {showNav && <SidebarNav />}

      <div className="app-main relative">

        {/* Email Verification Banner */}
        <EmailVerifyBanner />

        <div className="page-enter">
          {children}
        </div>

      </div>

      {showNav && <BottomNav />}

      {showWelcomeSlider && <WelcomeSlider />}
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    // Brief branding flash only -- this used to force a flat 2.5s wait on
    // every single page load/refresh regardless of how fast the session
    // actually resolved, which is most of what made the app feel slow to
    // "get in" even when the network calls themselves were quick.
    const t = setTimeout(() => setInitialLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  if (initialLoading || authLoading) return <LoadingPage />;

  return (
    <CallProvider>
      <CursorGlow />
      <BackgroundBlobs />

      <Suspense fallback={<LoadingPage />}>
        <Routes>

          {/* Public Routes */}
          <Route
            path="/"
            element={isAuthenticated ? <Navigate to="/home" replace /> : <AuthPage />}
          />

          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/verify-pawprint" element={<VerifyPawprintPage />} />

          {/* Protected Onboarding */}
          <Route
            path="/pet-selection"
            element={
              <ProtectedRoute>
                <PetSelectionPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/create-profile"
            element={
              <ProtectedRoute>
                <CreateProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Main App */}
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <HomePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/meet"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <MeetPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ChatPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ProfilePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile/:id"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ProfilePage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/spotlight"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SpotlightPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/community/create"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CreateCommunityPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/community/:id"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <CommunityPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
      </Suspense>
    </CallProvider>
  );
}