/**
 * Panoul de emoji de deasupra composerului: taburi pe categorii (plus
 * „recente") și o grilă. Alegerea NU trimite nimic — doar inserează la cursor,
 * prin `onPick`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EMOJI_CATEGORIES, loadRecentEmoji, pushRecentEmoji, type EmojiCategoryId } from './emojiData';

type TabId = 'recent' | EmojiCategoryId;

interface Props {
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ onPick }: Props) {
  const { t } = useTranslation('screens');
  const [recent, setRecent] = useState<string[]>(() => loadRecentEmoji());
  const [tab, setTab] = useState<TabId>(() => (recent.length > 0 ? 'recent' : 'smileys'));

  const list =
    tab === 'recent' ? recent : (EMOJI_CATEGORIES.find((c) => c.id === tab)?.emoji ?? []);

  const pick = (emoji: string) => {
    setRecent(pushRecentEmoji(emoji));
    onPick(emoji);
  };

  const tabs: { id: TabId; icon: string }[] = [
    { id: 'recent', icon: '🕘' },
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: c.icon })),
  ];

  return (
    <div className="emoji-picker" data-testid="emoji-picker" role="dialog" aria-label={t('chat.emoji.title')}>
      <div className="emoji-picker__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-label={t(`chat.emoji.tabs.${item.id}`)}
            className={tab === item.id ? 'emoji-picker__tab emoji-picker__tab--active' : 'emoji-picker__tab'}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="emoji-picker__empty">{t('chat.emoji.recentEmpty')}</p>
      ) : (
        <div className="emoji-picker__grid" role="tabpanel">
          {list.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="emoji-picker__item"
              aria-label={emoji}
              // `mousedown` fără focus: câmpul de text își păstrează cursorul.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
