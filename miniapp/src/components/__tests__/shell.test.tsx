/**
 * Cadrul de navigare: bara de taburi și ecranele „în adâncime".
 *
 * Ce apărăm aici: butonul ÎNAPOI NATIV al Telegramului chiar se leagă. Hook-ul
 * `useTelegramBackButton` era scris și testat, dar nefolosit; un ecran adânc
 * fără el e o fundătură — utilizatorul nu are cum să iasă.
 */
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';
import { installTelegramStub } from '@/test/telegramStub';

import { DeepScreen } from '../DeepScreen';
import { TABS, TabBar } from '../TabBar';

function renderAt(ui: React.ReactElement, path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('bara de taburi', () => {
  it('arată toate taburile, cu etichete traduse', () => {
    renderAt(<TabBar />, '/feed');

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(TABS.length);
    // Eticheta se citește din catalog, nu se scrie în test: un test care își
    // repetă traducerile nu verifică traducerea, ci se verifică pe sine.
    for (const tab of TABS) {
      expect(screen.getByRole('link', { name: new RegExp(i18n.t(tab.labelKey, { ns: 'miniapp' })) })).toBeInTheDocument();
    }
  });

  it('marchează tabul rutei curente, și doar pe acela', () => {
    const primul = TABS[0]!;
    const restul = TABS.slice(1);
    renderAt(<TabBar />, primul.to);

    const activ = screen.getByRole('link', { name: new RegExp(i18n.t(primul.labelKey, { ns: 'miniapp' })) });
    expect(activ).toHaveClass('tab--active');

    for (const tab of restul) {
      expect(
        screen.getByRole('link', { name: new RegExp(i18n.t(tab.labelKey, { ns: 'miniapp' })) }),
      ).not.toHaveClass('tab--active');
    }
  });

  it('fiecare tab duce la o cale distinctă', () => {
    // Un `to` duplicat ar face două taburi să se aprindă simultan, iar defectul
    // s-ar vedea abia pe telefon.
    expect(new Set(TABS.map((tab) => tab.to)).size).toBe(TABS.length);
  });
});

describe('ecran în adâncime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('afișează butonul ÎNAPOI nativ al Telegramului și îl curăță la ieșire', () => {
    const { webApp } = installTelegramStub();

    const { unmount } = renderAt(<DeepScreen title="Conversație">conținut</DeepScreen>, '/x');

    expect(webApp.BackButton.show).toHaveBeenCalled();
    expect(webApp.BackButton.onClick).toHaveBeenCalled();

    unmount();
    expect(webApp.BackButton.hide).toHaveBeenCalled();
    expect(webApp.BackButton.offClick).toHaveBeenCalled();
  });

  it('are și un buton propriu în DOM: în browser nu există buton nativ', () => {
    renderAt(<DeepScreen>conținut</DeepScreen>, '/x');

    expect(screen.getByTestId('deep-back')).toBeInTheDocument();
  });

  it('folosește ieșirea proprie când i se dă una', () => {
    const onBack = vi.fn();
    renderAt(<DeepScreen onBack={onBack}>conținut</DeepScreen>, '/x');

    fireEvent.click(screen.getByTestId('deep-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
