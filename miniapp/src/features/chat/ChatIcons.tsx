/**
 * Iconițele conversației, desenate în SVG (fereastră 24×24, linie 2) — aceeași
 * grosime pe orice platformă, spre deosebire de emoji-urile de sistem.
 * Toate sunt decorative (`aria-hidden`): eticheta stă pe butonul care le conține.
 */
import type { ReactElement } from 'react';

export type ChatIconName =
  | 'flag'
  | 'block'
  | 'send'
  | 'mic'
  | 'smile'
  | 'keyboard'
  | 'paperclip'
  | 'close'
  | 'play'
  | 'pause'
  | 'check'
  | 'checks'
  | 'clock'
  | 'retry'
  | 'trash'
  | 'heart'
  | 'alert';

const PATHS: Record<ChatIconName, ReactElement> = {
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  send: <path d="M4 12l16-8-6 16-3-7-7-1z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </>
  ),
  paperclip: (
    <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4L14.6 7.5" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checks: (
    <>
      <path d="M2 12.5l4.5 4.5L16 7.5" />
      <path d="M11.5 16.5l.5.5L21.5 7.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  retry: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </>
  ),
  heart: (
    <path
      d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
      fill="currentColor"
      stroke="none"
    />
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
};

interface Props {
  name: ChatIconName;
  size?: number;
  className?: string;
}

export function ChatIcon({ name, size = 22, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
