import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n';
import '@/styles/global.css';
import '@/styles/feed.css';

import { App } from '@/App';

/**
 * Un singur `QueryClient`, ca pe mobil. `retry: 1` — într-un Mini App deschis
 * pe date mobile, o reîncercare ajută; trei ar ține utilizatorul pe spinner.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root lipsește din index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
