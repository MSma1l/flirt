import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnketaWizard from '../index';
import { useAnketaStore } from '@/features/anketa/anketaStore';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

// Mock store de auth: doar `setProfileCompleted` e folosit de ecran.
const mockSetProfileCompleted = jest.fn();
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { setProfileCompleted: typeof mockSetProfileCompleted }) => unknown) =>
    selector({ setProfileCompleted: mockSetProfileCompleted }),
}));

// Mock la anketaApi: controlăm referința și spionăm submit-ul.
const mockFetchReference = jest.fn(() =>
  Promise.resolve({
    genders: ['Femeie', 'Bărbat'],
    datingStatuses: ['Prietenie', 'Relație'],
    languages: ['Română', 'Engleză'],
    interests: [
      { slug: 'sport', label: 'Sport' },
      { slug: 'muzica', label: 'Muzică' },
    ],
  }),
);
const mockSubmitAnketa = jest.fn((_draft: unknown) => Promise.resolve());
jest.mock('@/features/anketa/anketaApi', () => ({
  fetchReference: () => mockFetchReference(),
  submitAnketa: (draft: unknown) => mockSubmitAnketa(draft),
}));

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AnketaWizard />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Completează valid pasul 0 (Despre tine). */
function fillStep0(
  utils: ReturnType<typeof renderWizard>,
  birthDate = '1998-05-20',
) {
  const { getByPlaceholderText, getByText } = utils;
  fireEvent.changeText(getByPlaceholderText('Numele tău'), 'Ana');
  fireEvent.changeText(getByPlaceholderText('1998-05-20'), birthDate);
  fireEvent.press(getByText('Femeie'));
  fireEvent.changeText(getByPlaceholderText('175'), '175');
}

describe('AnketaWizard (onboarding)', () => {
  beforeEach(() => {
    mockFetchReference.mockClear();
    mockSubmitAnketa.mockClear();
    mockSetProfileCompleted.mockClear();
    mockReplace.mockClear();
    // Store real (Zustand) — resetăm draftul și pasul între teste.
    useAnketaStore.getState().reset();
  });

  it('încarcă referința și arată primul pas', async () => {
    const { getByText } = renderWizard();
    await waitFor(() => getByText('Despre tine'));
    expect(mockFetchReference).toHaveBeenCalled();
  });

  it('validarea blochează avansarea cu vârstă sub 16 ani', async () => {
    const utils = renderWizard();
    await waitFor(() => utils.getByText('Despre tine'));

    // Data nașterii implică ~11 ani → sub limita de 16.
    fillStep0(utils, '2015-01-01');
    fireEvent.press(utils.getByText('Continuă'));

    // Mesajul de eroare apare și rămânem pe primul pas.
    await waitFor(() => utils.getByText('Trebuie să ai cel puțin 16 ani.'));
    expect(utils.getByText('Despre tine')).toBeTruthy();
    expect(utils.queryByText('Localizare')).toBeNull();
  });

  it('la final apelează submitAnketa cu payload corect', async () => {
    const utils = renderWizard();
    const { getByPlaceholderText, getByText } = utils;
    await waitFor(() => getByText('Despre tine'));

    // Pas 0 — Despre tine.
    fillStep0(utils);
    fireEvent.press(getByText('Continuă'));

    // Pas 1 — Localizare.
    await waitFor(() => getByText('Localizare'));
    fireEvent.changeText(getByPlaceholderText('Orașul tău'), 'Chișinău');
    fireEvent.press(getByText('Română'));
    fireEvent.press(getByText('Continuă'));

    // Pas 2 — Prezentare (câmpuri opționale, avansăm direct).
    await waitFor(() => getByText('Prezentare'));
    fireEvent.press(getByText('Continuă'));

    // Pas 3 — Interese.
    await waitFor(() => getByText('Interese'));
    fireEvent.press(getByText('Sport'));
    fireEvent.press(getByText('Finalizează'));

    await waitFor(() => {
      expect(mockSubmitAnketa).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ana',
          birthDate: '1998-05-20',
          gender: 'Femeie',
          heightCm: 175,
          city: 'Chișinău',
          languages: ['Română'],
          interests: ['sport'],
        }),
      );
    });
    await waitFor(() => {
      expect(mockSetProfileCompleted).toHaveBeenCalledWith(true);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete');
    });
  });
});
