/**
 * Copierea unui text scurt (un cod de invitație) cu CONFIRMARE VIZIBILĂ.
 *
 * DE CE E UN COMPONENT, NU UN `onClick` ÎNTR-O PAGINĂ: un cod de 12 caractere
 * transcris de mână se greșește — „0" citit ca „O", „1" ca „I". Alfabetul
 * codurilor de pe backend (`_CODE_ALPHABET`) elimină deja caracterele ambigue,
 * dar drumul sigur rămâne copierea, iar copierea fără confirmare lasă adminul să
 * se întrebe dacă s-a întâmplat ceva. Aici: butonul spune „Copiat!" două secunde.
 *
 * `navigator.clipboard` lipsește pe http (non-secure context) și în browsere
 * vechi — de aceea există căderea pe `document.execCommand('copy')`, iar eșecul
 * total se spune pe față, nu se înghite.
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from './ui';

type CopyState = 'idle' | 'done' | 'failed';

/** Copiere cu alternativă pentru contextele fără Clipboard API. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // cădem pe varianta veche
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = 'Copiază',
  title,
  small = true,
}: {
  value: string;
  label?: string;
  /** Text pentru cititoarele de ecran / tooltip („Copiază codul invitației"). */
  title?: string;
  small?: boolean;
}): JSX.Element {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const run = (): void => {
    void copyText(value).then((ok) => {
      setState(ok ? 'done' : 'failed');
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    });
  };

  return (
    <Button
      small={small}
      variant={state === 'done' ? 'primary' : 'ghost'}
      onClick={run}
      title={title ?? label}
      // `aria-live` pe buton: schimbarea etichetei e anunțată, nu doar văzută.
      aria-live="polite"
    >
      {state === 'done' ? 'Copiat!' : state === 'failed' ? 'Nu s-a putut copia' : label}
    </Button>
  );
}
