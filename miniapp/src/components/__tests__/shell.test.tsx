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
    expect(screen.getByRole('link', { name: /Ankete/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Setări/ })).toBeInTheDocument();
  });

  it('marchează tabul rutei curente', () => {
    renderAt(<TabBar />, '/setari');

    expect(screen.getByRole('link', { name: /Setări/ })).toHaveClass('tab--active');
    expect(screen.getByRole('link', { name: /Ankete/ })).not.toHaveClass('tab--active');
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
