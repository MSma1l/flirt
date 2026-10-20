import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n';
import '@/styles/fonts.css';
import '@/styles/global.css';
import '@/styles/status.css';
import '@/styles/feed.css';

import { App } from '@/App';

/**
 * Un singur `QueryClient`, ca pe mobil. `retry: 1` — într-un Mini App deschis
 * pe date mobile, o reîncercare ajută; trei ar ține utilizatorul pe spinner.
 *
 * `staleTime: 30_000` implicit: cu 0, fiecare schimbare de tab (feed → chat →
 * profil → înapoi) remonta ecranul și relansa TOATE cererile lui, deși datele
 * aveau câteva secunde. Excepțiile rămân la query-urile lor: `staleTime: 0`
 * explicit unde datele trebuie să fie proaspete la montare, iar sincronizarea
 * vie (chat, activitate, bilete) merge prin `refetchInterval`, pe care
 * `staleTime` nu-l afectează. `invalidateQueries` după o mutație reîncarcă
 * oricum, indiferent de vârsta datelor.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
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
