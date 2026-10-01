/**
 * Setul de emoji al picker-ului din chat: ~150 de emoji populare, pe câteva
 * categorii, plus lista „recente" ținută în `localStorage`.
 *
 * Fără dependență: o bibliotecă completă de emoji are sute de KB, iar într-o
 * conversație de dating se folosesc, practic, aceleași câteva zeci.
 */

export type EmojiCategoryId = 'smileys' | 'love' | 'gestures' | 'fun' | 'nature';

export interface EmojiCategory {
  id: EmojiCategoryId;
  /** Emoji-ul afișat pe tab. */
  icon: string;
  emoji: readonly string[];
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: 'smileys',
    icon: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝',
      '🤗', '🤭', '🤫', '🤔', '😐', '😏', '😒', '🙄', '😬', '😌', '😔', '😴',
      '🥳', '😎', '🤓', '🥺', '😢', '😭', '😤', '😡', '🤯', '😳', '🥵', '😱',
    ],
  },
  {
    id: 'love',
    icon: '❤️',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕',
      '💞', '💓', '💗', '💖', '💘', '💝', '💋', '💌', '😻', '🌹', '💐', '💍',
      '🔥', '✨', '💫', '⭐', '🌙', '☀️',
    ],
  },
  {
    id: 'gestures',
    icon: '👋',
    emoji: [
      '👋', '🤚', '✋', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '👇', '👍', '👎', '👊', '👏', '🙌', '🫶', '🤝', '🙏', '💪', '👀',
      '🙈', '🙉', '🙊', '💃', '🕺', '👯',
    ],
  },
  {
    id: 'fun',
    icon: '🎉',
    emoji: [
      '🎉', '🎊', '🎁', '🎈', '🎂', '🍾', '🥂', '🍷', '🍸', '🍹', '🍺', '☕',
      '🍕', '🍔', '🍟', '🍣', '🍓', '🍒', '🍑', '🍫', '🍿', '🎵', '🎶', '🎤',
      '🎧', '🎬', '🎮', '⚽', '✈️', '🏖️',
    ],
  },
  {
    id: 'nature',
    icon: '🌸',
    emoji: [
      '🌸', '🌺', '🌻', '🌷', '🍀', '🌈', '☁️', '⛄', '🌊', '🐶', '🐱', '🦊',
      '🐻', '🐼', '🐨', '🦁', '🐰', '🦋',
    ],
  },
];

/** Câte emoji ținem în „recente". */
export const RECENT_LIMIT = 24;

const RECENT_KEY = 'flirt.chat.recentEmoji';

/** Emoji-urile folosite recent. Stocarea poate lipsi (mod privat) → listă goală. */
export function loadRecentEmoji(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Pune emoji-ul în capul listei de recente și întoarce lista nouă. */
export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...loadRecentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* stocare indisponibilă: recentele rămân doar pentru sesiunea curentă */
  }
  return next;
}

/**
 * Mesaj format DOAR din 1–3 emoji? Atunci îl afișăm mare, fără bulă.
 * Folosește `Intl.Segmenter` când există, ca un emoji compus (👨‍👩‍👧, 👍🏽) să
 * conteze ca unul singur.
 */
export function emojiOnlyCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return 0;
  const emojiRe = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️|‍|⃣|\s)+$/u;
  if (!emojiRe.test(trimmed)) return 0;
  // Cifrele și `#`/`*` sunt și ele „Emoji" în Unicode — nu le vrem mari.
  if (/[0-9#*]/.test(trimmed)) return 0;
  const compact = trimmed.replace(/\s+/g, '');
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const count = Segmenter
    ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(compact)].length
    : [...compact.replace(/[️‍]/g, '')].length;
  return count;
}
