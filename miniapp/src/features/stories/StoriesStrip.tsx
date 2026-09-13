/**
 * Poveștile în capul ecranului de ankete: bara sus, vizualizatorul peste tot
 * ecranul, feedul neatins dedesubt.
 *
 * ASTA E CERINȚA: până acum poveștile erau un ecran separat, ajuns printr-un
 * meniu — se deschidea, arăta un cerc de adăugare, și atât. Aplicația nativă
 * face de mult lucrul corect (`mobile/app/(tabs)/ankete.tsx` randează
 * `<StoriesBar />` deasupra deck-ului), iar aici e portarea aceluiași lucru.
 *
 * DE CE E UN SINGUR COMPONENT, montat ÎN interiorul feedului, și nu o navigare:
 * la închiderea poveștii utilizatorul trebuie să se întoarcă în ACEEAȘI poziție
 * din teanc. O navigare către `/stories` ar demonta `SwipeDeck`, iar la
 * întoarcere `index` ar porni iar de la zero — adică exact plângerea „m-a
 * aruncat la primul card". Aici se schimbă doar starea locală a barei, deci
 * deck-ul nici nu află că s-a întâmplat ceva.
 *
 * Vizualizatorul e `position: fixed` peste tot ecranul (`storiesBar.css`), deci
 * cât e deschis niciun gest nu ajunge la card — nici geometric, nici prin
 * propagare (zona de gesturi e marcată și aici).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StoriesBar, STORIES_GESTURE_ZONE } from './StoriesBar';
import { StoryComposer } from './StoryComposer';
import { StoryViewer } from './StoryViewer';
import { useStoriesQuery } from './useStories';

import './stories.css';

/** Ce e deschis peste feed: nimic, o poveste, sau crearea unei povești. */
type Mode = { kind: 'closed' } | { kind: 'viewer'; userId: string } | { kind: 'compose' };

const CLOSED: Mode = { kind: 'closed' };

/** Oprește un gest să urce mai departe în pagină (spre deck). */
function keepGesture(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

export function StoriesStrip() {
  const { t } = useTranslation(['screens', 'common']);
  const [mode, setMode] = useState<Mode>(CLOSED);
  const stories = useStoriesQuery();

  const groups = stories.data ?? [];
  const group = mode.kind === 'viewer' ? groups.find((g) => g.userId === mode.userId) : undefined;
  const close = () => setMode(CLOSED);

  /**
   * Grupul poate dispărea sub noi: povestea a expirat (24h) sau a fost ștearsă,
   * iar un refetch aduce lista fără el. Atunci închidem singuri, în loc să
   * lăsăm un ecran plin, gol.
   */
  useEffect(() => {
    if (mode.kind === 'viewer' && !stories.isPending && !group) setMode(CLOSED);
  }, [mode, stories.isPending, group]);

  /** ESC închide povestea — pe desktop e reflexul, iar costul e o linie. */
  useEffect(() => {
    if (mode.kind === 'closed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode(CLOSED);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode.kind]);

  const content =
    mode.kind === 'compose' ? (
      <StoryComposer onClose={close} />
    ) : group ? (
      <StoryViewer key={group.userId} group={group} onClose={close} />
    ) : null;

  return (
    <>
      <StoriesBar
        variant="feed"
        selectedUserId={mode.kind === 'viewer' ? mode.userId : null}
        onAdd={() => setMode({ kind: 'compose' })}
        onOpenGroup={(userId) => setMode({ kind: 'viewer', userId })}
      />

      {content ? (
        <div
          className="st-overlay"
          data-testid="stories-overlay"
          data-gesture-zone={STORIES_GESTURE_ZONE}
          role="dialog"
          aria-modal="true"
          aria-label={t('screens:stories.title')}
          onPointerDown={keepGesture}
          onPointerMove={keepGesture}
          onPointerUp={keepGesture}
          onPointerCancel={keepGesture}
          onTouchMove={keepGesture}
        >
          <div className="st-overlay__panel">{content}</div>
        </div>
      ) : null}
    </>
  );
}

export default StoriesStrip;
