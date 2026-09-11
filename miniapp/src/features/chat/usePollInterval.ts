/**
 * Interogare periodică oprită când fereastra nu e vizibilă.
 *
 * Chat-ul se actualizează prin POLLING (ca pe mobil), nu prin WebSocket — e
 * deja abordarea stivei. Într-un WebView de Telegram însă, aplicația rămâne
 * „vie" și când utilizatorul comută pe alt chat: fără oprire, cererile ar
 * continua la fiecare 3 secunde și ar consuma baterie și trafic degeaba.
 *
 * `usePollInterval(ms)` întoarce `ms` cât timp documentul e vizibil și `false`
 * când nu e — exact valoarea pe care o așteaptă `refetchInterval` din TanStack
 * Query (`false` = fără poll). Oprirea e EXPLICITĂ, nu lăsată pe seama
 * `focusManager`-ului din React Query: vrem să fie vizibilă în cod și testabilă.
 *
 * La revenirea în prim-plan, React Query declanșează imediat o interogare
 * (intervalul se remontează), deci ecranul nu rămâne cu date vechi.
 */
import { useEffect, useState } from 'react';

/** `document.visibilityState`, tolerant la medii fără API-ul de vizibilitate. */
function readVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

/** True cât timp pagina e vizibilă; se reevaluează la `visibilitychange`. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(readVisible);

  useEffect(() => {
    const onChange = () => setVisible(readVisible());
    document.addEventListener('visibilitychange', onChange);
    // Telegram poate minimiza Mini App-ul fără `visibilitychange` pe unii
    // clienți; `pagehide`/`pageshow` acoperă și cazul acela.
    window.addEventListener('pagehide', onChange);
    window.addEventListener('pageshow', onChange);
    // Starea se putea schimba între primul randare și atașarea ascultătorilor.
    onChange();
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pagehide', onChange);
      window.removeEventListener('pageshow', onChange);
    };
  }, []);

  return visible;
}

/** `ms` cât timp fereastra e vizibilă, `false` altfel. */
export function usePollInterval(ms: number): number | false {
  return usePageVisible() ? ms : false;
}
