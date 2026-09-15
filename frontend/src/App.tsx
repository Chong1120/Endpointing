import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';

// Route-level code splitting keeps the initial bundle small.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const LiveAgentPage = page(() => import('./pages/LiveAgentPage'), 'LiveAgentPage');
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
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="agent" element={<LiveAgentPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="calls/:id" element={<CallDetailPage />} />
          <Route path="calls/:id/processing" element={<ProcessingPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
