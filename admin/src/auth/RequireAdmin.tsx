/**
 * Gardă de rutare: nicio pagină a panoului nu se randează fără o sesiune de admin
 * confirmată de backend. (Garda reală rămâne serverul — asta e doar UX.)
 */
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingState } from '../components/ui';
import { useAuth } from './AuthContext';

export function RequireAdmin({ children }: { children: JSX.Element }): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingState label="Se verifică sesiunea…" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}
