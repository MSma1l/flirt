/**
 * Ecranul separat de povești (`/stories`).
 *
 * NU MAI E DRUMUL PRINCIPAL. Bara de povești stă acum în capul ecranului de
 * ankete, deasupra cărților de swipe (`StoriesStrip` → `features/feed`), exact
 * ca în aplicația nativă, unde `app/(tabs)/ankete.tsx` randează `<StoriesBar />`
 * peste deck. Ecranul ăsta rămâne funcțional doar ca să nu se rupă linkurile
 * directe și butonul „înapoi" al clientului Telegram.
 *
 * Ecranul nu mai conține logică proprie: bara, vizualizatorul și crearea sunt
 * trei componente (`StoriesBar`, `StoryViewer`, `StoryComposer`), aceleași pe
 * care le folosește și feedul. Aici sunt așezate ÎN PAGINĂ (ecran separat,
 * derulabil), în feed vizualizatorul se deschide peste tot ecranul.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StoriesBar } from './StoriesBar';
import { StoryComposer } from './StoryComposer';
import { StoryViewer } from './StoryViewer';
import { useMyStoryIds, useStoriesQuery } from './useStories';

import './stories.css';

export function StoriesScreen() {
  // `stories` și `common` sunt cataloagele mobile REUTILIZATE; `screens` e
  // catalogul propriu al Mini App-ului, pentru textele care nu există pe mobil.
  const { t } = useTranslation(['stories', 'common', 'screens']);

  const [composing, setComposing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const stories = useStoriesQuery();
  // Cerută AICI, nu doar în vizualizator: la deschiderea unui grup se știe deja
  // care povești sunt ale utilizatorului, deci butonul de ștergere apare din
  // primul cadru, nu după o a doua cerere.
  useMyStoryIds();

  const groups = stories.data ?? [];
  const group = groups.find((g) => g.userId === selectedUserId);

  if (composing) {
    return (
      <div className="st-screen">
        <StoryComposer onClose={() => setComposing(false)} />
      </div>
    );
  }

  return (
    <div className="st-screen">
      <h1 className="title">{t('screens:stories.title')}</h1>

      <StoriesBar
        selectedUserId={selectedUserId}
        onAdd={() => setComposing(true)}
        onOpenGroup={setSelectedUserId}
      />

      {/* Încărcarea și eroarea vin ÎNAINTEA ramurii de „gol": altfel, cât timp
          `fetchStories` e în zbor, lista e goală și userul ar citi „nu există
          povești" în loc să vadă spinnerul. */}
      {stories.isPending ? (
        <div className="st-state">
          <div className="spinner" role="status" aria-label={t('stories:viewer.retry')} />
        </div>
      ) : stories.isError ? (
        <div className="st-state" data-testid="stories-error">
          <p className="error-text">{t('stories:viewer.loadError')}</p>
          <button
            type="button"
            className="button"
            disabled={stories.isFetching}
            onClick={() => void stories.refetch()}
          >
            {t('stories:viewer.retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="st-state" data-testid="stories-empty">
          <p className="body-text">{t('stories:viewer.empty')}</p>
        </div>
      ) : group ? (
        <StoryViewer
          // Schimbarea grupului trebuie să repornească vizualizatorul de la
          // prima poveste: `key` face exact asta, fără un efect de resetare.
          key={group.userId}
          group={group}
          onClose={() => setSelectedUserId(null)}
        />
      ) : null}
    </div>
  );
}

export default StoriesScreen;
