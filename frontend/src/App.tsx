import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { RequirePermission } from './components/common';
import { useAuth } from './hooks/useAuth';
import { MeProvider, useMe, useMeState } from './hooks/useMe';
import { AppLayout } from './layouts/AppLayout';
import { CustomerLayout } from './layouts/CustomerLayout';
import { CustomerHomePage } from './pages/CustomerHomePage';
import { LoginPage } from './pages/LoginPage';

// Route-level code splitting keeps the initial bundle small.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const LiveAgentPage = page(() => import('./pages/LiveAgentPage'), 'LiveAgentPage');
const FollowUpsPage = page(() => import('./pages/FollowUpsPage'), 'FollowUpsPage');
const TeamPage = page(() => import('./pages/TeamPage'), 'TeamPage');
const UploadPage = page(() => import('./pages/UploadPage'), 'UploadPage');
const CallsPage = page(() => import('./pages/CallsPage'), 'CallsPage');
const CallDetailPage = page(() => import('./pages/CallDetailPage'), 'CallDetailPage');
const ProcessingPage = page(() => import('./pages/ProcessingPage'), 'ProcessingPage');
const AnalyticsPage = page(() => import('./pages/AnalyticsPage'), 'AnalyticsPage');
const PoliciesPage = page(() => import('./pages/PoliciesPage'), 'PoliciesPage');
const AuditPage = page(() => import('./pages/AuditPage'), 'AuditPage');

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Staff get the console; a customer gets the Northwind support page and nothing else. */
function Shell() {
  const { me, loading } = useMeState();
  if (loading && !me) return <FullPageSpinner />;
  return me?.user.role === 'customer' ? <CustomerLayout /> : <AppLayout />;
}

/** Customers only call and look back at their own list; the staff pages are not for them. */
function StaffOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me) return <FullPageSpinner />;
  return me.user.role === 'customer' ? <Navigate to="/" replace /> : <>{children}</>;
}

/**
 * "Home" is wherever that role actually works: the phone line for a customer,
 * the queue for a support agent, the dashboard for everyone else. The dashboard
 * reads analytics, which a support agent may not, so sending them there would
 * greet them with a permission error.
 */
function Home() {
  const me = useMe();
  if (!me) return <FullPageSpinner />;
  if (me.user.role === 'customer') return <CustomerHomePage />;
  if (!me.user.permissions.includes('analytics:read') && me.user.permissions.includes('followups:read')) return <FollowUpsPage />;
  return <DashboardPage />;
}

function NotFound() {
  return (
    <Box sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h2">Page not found</Typography>
      <Button component={RouterLink} to="/" sx={{ mt: 2 }} variant="contained">
        Back to dashboard
      </Button>
    </Box>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <MeProvider>
                <Shell />
              </MeProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route
            path="agent"
            element={
              <RequirePermission permission="agent:call">
                <LiveAgentPage />
              </RequirePermission>
            }
          />
          <Route
            path="escalations"
            element={
              <RequirePermission permission="followups:read">
                <FollowUpsPage />
              </RequirePermission>
            }
          />
          <Route
            path="upload"
            element={
              <RequirePermission permission="calls:upload">
                <UploadPage />
              </RequirePermission>
            }
          />
          <Route
            path="team"
            element={
              <RequirePermission permission="team:read">
                <TeamPage />
              </RequirePermission>
            }
          />
          <Route
            path="calls"
            element={
              <RequirePermission permission="calls:browse">
                <CallsPage />
              </RequirePermission>
            }
          />
          {/* A customer has no business on the staff call pages, even for their own call. */}
          <Route
            path="calls/:id"
            element={
              <StaffOnly>
                <CallDetailPage />
              </StaffOnly>
            }
          />
          <Route
            path="calls/:id/processing"
            element={
              <StaffOnly>
                <ProcessingPage />
              </StaffOnly>
            }
          />
          <Route
            path="analytics"
            element={
              <RequirePermission permission="analytics:read">
                <AnalyticsPage />
              </RequirePermission>
            }
          />
          <Route
            path="policies"
            element={
              <RequirePermission permission="policies:write">
                <PoliciesPage />
              </RequirePermission>
            }
          />
          <Route
            path="audit"
            element={
              <RequirePermission permission="audit:read">
                <AuditPage />
              </RequirePermission>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
