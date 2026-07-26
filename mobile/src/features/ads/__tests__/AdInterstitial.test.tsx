import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import {
  AdInterstitial,
  buildAdVideoHtml,
  resolveCountdownSeconds,
} from '../AdInterstitial';
import { Ad } from '../types';

// Telemetria (impression/click) lovește backendul — o spionăm, nu o executăm.
const mockImpression = jest.fn((_id: number) => Promise.resolve());
const mockClick = jest.fn((_id: number) => Promise.resolve());
jest.mock('../adsApi', () => ({
  reportAdImpression: (id: number) => mockImpression(id),
  reportAdClick: (id: number) => mockClick(id),
}));

const imageAd: Ad = {
  id: 42,
  title: 'Reclamă test',
  videoUrl: null,
  imageUrl: 'https://cdn.example/ad.jpg',
  durationSeconds: 3,
};

function renderAd(props: Partial<React.ComponentProps<typeof AdInterstitial>> = {}) {
  const onClose = jest.fn();
  const utils = render(
    <ThemeProvider>
      <AdInterstitial visible ad={imageAd} maxSeconds={10} onClose={onClose} {...props} />
    </ThemeProvider>,
  );
  return { ...utils, onClose };
}

describe('AdInterstitial — resolveCountdownSeconds', () => {
  it('ia minimul dintre durata reclamei și limita din config', () => {
    expect(resolveCountdownSeconds(3, 10)).toBe(3);
    expect(resolveCountdownSeconds(30, 10)).toBe(10);
  });

  it('o durată absentă/invalidă cade pe limita din config', () => {
    expect(resolveCountdownSeconds(0, 10)).toBe(10);
    expect(resolveCountdownSeconds(-5, 10)).toBe(10);
  });

  it('nu coboară niciodată sub 1 secundă', () => {
    expect(resolveCountdownSeconds(0, 0)).toBe(1);
    expect(resolveCountdownSeconds(-1, -1)).toBe(1);
  });
});

describe('AdInterstitial — buildAdVideoHtml', () => {
  it('include URL-ul video în documentul HTML', () => {
    const html = buildAdVideoHtml('https://cdn.example/v.mp4');
    expect(html).toContain('https://cdn.example/v.mp4');
    expect(html).toContain('<video');
  });

  it('escapează „<" ca să nu se poată închide blocul <script> din URL', () => {
    const html = buildAdVideoHtml('https://x/</script><script>alert(1)</script>');
    // Niciun `</script>` literal injectat nu supraviețuiește în document.
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c');
  });
});

describe('AdInterstitial — UI/UX', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockImpression.mockClear();
    mockClick.mockClear();
  });
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('nu randează nimic când nu există reclamă', () => {
    const { queryByTestId } = renderAd({ ad: null });
    expect(queryByTestId('ad-interstitial')).toBeNull();
  });

  it('randează reclama-imagine și eticheta „Reclamă"', () => {
    const { getByTestId, getByText } = renderAd();
    expect(getByTestId('ad-interstitial')).toBeTruthy();
    expect(getByTestId('ad-image')).toBeTruthy();
    expect(getByText('Reclamă')).toBeTruthy();
  });

  it('raportează O SINGURĂ afișare (impression) la apariția reclamei', () => {
    renderAd();
    // Chiar dacă countdown-ul tickăie și re-randează, impression rămâne unic.
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockImpression).toHaveBeenCalledTimes(1);
    expect(mockImpression).toHaveBeenCalledWith(42);
  });

  it('countdown: butonul de închidere e DEZACTIVAT până la 0', () => {
    const { getByTestId, onClose } = renderAd();
    const close = getByTestId('ad-close');

    // La start countdown-ul arată secundele rămase, nu „Închide".
    expect(close.props.accessibilityState.disabled).toBe(true);
    expect(close).toHaveTextContent('3');

    // Apăsarea înainte de final NU închide.
    fireEvent.press(close);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('countdown: la 0 butonul devine activ și închide reclama', () => {
    const { getByTestId, onClose } = renderAd();

    // Durata = min(3, 10) = 3s → avansăm până expiră.
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    const close = getByTestId('ad-close');
    // La final butonul devine activ (nu mai afișează un număr de countdown).
    expect(close.props.accessibilityState.disabled).toBe(false);
    expect(close).not.toHaveTextContent('3');

    fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('click pe reclamă raportează un click (best-effort)', () => {
    const { getByTestId } = renderAd();
    const clickable = getByTestId('ad-clickable');
    expect(clickable.props.accessibilityRole).toBe('link');

    fireEvent.press(clickable);
    expect(mockClick).toHaveBeenCalledWith(42);
  });

  it('butonul de închidere are etichetă accesibilă care reflectă starea', () => {
    const { getByTestId } = renderAd();
    const close = getByTestId('ad-close');
    // Cât timp e blocat, eticheta anunță câte secunde mai sunt.
    expect(close.props.accessibilityLabel).toContain('Poți închide în');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(getByTestId('ad-close').props.accessibilityLabel).toBe('Închide reclama');
  });
});
