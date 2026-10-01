/**
 * Iconițele SVG ale ecranului de profil (modul de vizualizare).
 *
 * Desenate în linie, cu `currentColor`, ca să urmeze culoarea textului din jur
 * (deci și tema clientului Telegram). Sunt pur decorative: textul de lângă ele
 * poartă sensul, așa că toate au `aria-hidden`.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GenderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="14" r="5" />
      <path d="M13.5 10.5 20 4M15 4h5v5" />
    </Svg>
  );
}

export function HeightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </Svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </Svg>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M9.6 6C6.5 7.3 4.5 10 4.5 13.6V18h5.4v-5.4H7.2c.1-2.2 1.3-3.8 3.4-4.8L9.6 6Zm9 0c-3.1 1.3-5.1 4-5.1 7.6V18h5.4v-5.4h-2.7c.1-2.2 1.3-3.8 3.4-4.8L18.6 6Z" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3v11H4V8Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </Svg>
  );
}

/** Insigna de verificare: rozetă plină cu bifă, ca la rețelele sociale. */
export function VerifiedIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="currentColor"
        d="M12 1.8l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22.2l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2L12 1.8Z"
      />
      <path
        d="m8.2 12.2 2.6 2.6 5-5.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Svg>
  );
}
