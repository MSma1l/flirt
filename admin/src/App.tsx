/**
 * Rutarea panoului. Tot ce nu e `/login` trece prin garda de admin.
 *
 * Ecranele sunt încărcate leneș: recharts (graficele) e cel mai greu pachet din
 * proiect și nu are ce căuta în bundle-ul ecranului de login sau al cozii de
 * moderare — cele două ecrane care trebuie să se deschidă instant.
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAdmin } from './auth/RequireAdmin';
import { Layout } from './components/Layout';
import { LoadingState } from './components/ui';
import { LoginPage } from './pages/LoginPage';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const ModerationPage = lazy(() =>
  import('./pages/ModerationPage').then((m) => ({ default: m.ModerationPage })),
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const EventsPage = lazy(() =>
  import('./pages/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const SubscriptionsPage = lazy(() =>
  import('./pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })),
);

export function App(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAdmin>
              <Layout />
            </RequireAdmin>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/moderation" element={<ModerationPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
