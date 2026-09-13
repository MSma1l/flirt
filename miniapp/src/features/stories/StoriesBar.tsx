/**
 * Bara de povești: cercul de adăugare, apoi cercurile celorlalți, pe orizontală.
 *
 * PORT al lui `mobile/src/features/stories/StoriesBar.tsx`, cu aceeași ordine
 * („+" primul) și același conținut al cercului (inițiala numelui). Două lucruri
 * sunt însă ALE MINI APP-ULUI, fiindcă aici bara stă în capul ecranului de
 * ankete, peste deck-ul de swipe:
 *
 *  1. IZOLAREA GESTURILOR. Deck-ul ascultă `pointerdown/move/up` și reacționează
 *     pe ambele axe; bara derulează pe orizontală. Suprapuse, una ar fura-o pe
 *     cealaltă. Bara își declară deci zona (`data-gesture-zone="stories"`),
 *     OPREȘTE propagarea evenimentelor de pointer și cere browserului doar
 *     derulare orizontală (`touch-action: pan-x` în CSS). Deck-ul, la rândul
 *     lui, ignoră orice gest pornit într-o zonă străină — vezi `SwipeDeck.tsx`.
 *     Ambele capete sunt scrise explicit, ca izolarea să nu depindă de faptul
 *     (astăzi adevărat) că bara nu e un descendent al cardului.
 *
 *  2. ÎNĂLȚIMEA. `flex: 0 0 auto` + o variantă joasă pe ecrane mici: bara nu are
 *     voie să împingă cardul până devine inutilizabil (vezi `storiesBar.css`).
 *
 * Cercurile cu povești NEVĂZUTE se disting de cele văzute (inel de accent plin,
 * cu aură, față de un contur stins). Evidența e locală — `storySeen.ts` explică
 * de ce nu poate veni de la server.
 */
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { getSeenStories, groupHasUnseen, subscribeToSeenStories } from './storySeen';
import { useStoriesQuery } from './useStories';

import './storiesBar.css';

/**
 * Marcajul zonei de gesturi. Orice element cu atributul ăsta spune deck-ului:
 * „gestul care începe aici e al meu". Exportat, ca `SwipeDeck` să folosească
 * exact același șir, nu o copie scrisă de mână.
 */
export const STORIES_GESTURE_ZONE = 'stories';

interface Props {
  /** Grupul deschis acum (cerc evidențiat). `null` = niciunul. */
  selectedUserId?: string | null;
  onOpenGroup: (userId: string) => void;
  onAdd: () => void;
  /**
   * `feed` = varianta din capul ecranului de ankete, deasupra cărților:
   * mai joasă, lipită de marginea de sus.
   */
  variant?: 'screen' | 'feed';
}

/** Prima literă a numelui, majusculă (fallback „?"). Ca pe mobil. */
function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/** Oprește un gest să urce mai departe în pagină (spre deck). */
function keepGesture(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

export function StoriesBar({ selectedUserId = null, onOpenGroup, onAdd, variant = 'screen' }: Props) {
  const { t } = useTranslation(['stories', 'screens']);
  const { data, isError } = useStoriesQuery();
  const seen = useSyncExternalStore(subscribeToSeenStories, getSeenStories, getSeenStories);

  const groups = data ?? [];

  return (
    <div
      className={`st-bar${variant === 'feed' ? ' st-bar--feed' : ''}`}
      data-testid="stories-bar"
      // Starea e un ATRIBUT, nu un ecran de eroare: dacă poveștile nu s-au putut
      // încărca, bara rămâne un singur cerc de adăugare și feedul merge mai
      // departe. Un mesaj roșu în capul ecranului de ankete ar fi anunțat o
      // avarie pentru ceva ce nu e nici măcar conținutul principal.
      data-state={isError ? 'error' : groups.length === 0 ? 'empty' : 'ready'}
      data-gesture-zone={STORIES_GESTURE_ZONE}
      // `role="group"`, nu `<nav>`: bara de taburi e deja singurul reper de
      // navigare al aplicației, iar un al doilea reper în capul feedului ar
      // face „navigarea principală" ambiguă pentru un cititor de ecran.
      role="group"
      aria-label={t('screens:stories.barLabel')}
      onPointerDown={keepGesture}
      onPointerMove={keepGesture}
      onPointerUp={keepGesture}
      onPointerCancel={keepGesture}
      onTouchMove={keepGesture}
    >
      <button
        type="button"
        className="st-bar__item"
        data-testid="stories-add"
        aria-label={t('stories:bar.addLabel')}
        onClick={onAdd}
      >
        <span className="st-bar__ring st-bar__ring--add" aria-hidden="true">
          ＋
        </span>
        <span className="caption st-bar__name">{t('stories:bar.add')}</span>
      </button>

      {groups.map((group) => {
        const unseen = groupHasUnseen(group, seen);
        return (
          <button
            key={group.userId}
            type="button"
            className={`st-bar__item${group.userId === selectedUserId ? ' st-bar__item--active' : ''}`}
            data-testid={`story-group-${group.userId}`}
            data-unseen={unseen ? 'true' : 'false'}
            aria-label={t('stories:bar.open', { name: group.name })}
            onClick={() => onOpenGroup(group.userId)}
          >
            <span
              className={`st-bar__ring st-bar__ring--${unseen ? 'unseen' : 'seen'}`}
              aria-hidden="true"
            >
              {initial(group.name)}
            </span>
            <span className="caption st-bar__name">{group.name}</span>
            <span className="caption st-bar__count">{group.storyCount}</span>
          </button>
        );
      })}
    </div>
  );
}

export default StoriesBar;
