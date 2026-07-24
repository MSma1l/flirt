import { render } from '@testing-library/react-native';
import React from 'react';

import Index from '../index';
import { ThemeProvider } from '@theme/index';

// Mock Redirect: capturează href-ul în loc să navigheze real.
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

// Mock store: `useAuthStore(selector)` citește dintr-un state controlabil.
type AuthState = {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: { id: string; profile_completed: boolean } | null;
};
const mockAuthState: AuthState = { status: 'loading', user: null };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: AuthState) => unknown) => selector(mockAuthState),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <Index />
    </ThemeProvider>,
  );
}

describe('Index (redirect gate)', () => {
  beforeEach(() => {
    mockRedirect.mockClear();
    mockAuthState.status = 'loading';
    mockAuthState.user = null;
  });

  it('status loading → arată splash-ul (fără redirect)', () => {
    mockAuthState.status = 'loading';
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('FLIRT')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('unauthenticated → redirect la welcome', () => {
    mockAuthState.status = 'unauthenticated';
    renderScreen();
    expect(mockRedirect).toHaveBeenCalledWith('/(auth)/welcome');
  });

  it('authenticated + profil necompletat → redirect la onboarding', () => {
    mockAuthState.status = 'authenticated';
    mockAuthState.user = { id: 'u1', profile_completed: false };
    renderScreen();
    expect(mockRedirect).toHaveBeenCalledWith('/(onboarding)');
  });

  it('authenticated + profil completat → redirect la tabs', () => {
    mockAuthState.status = 'authenticated';
    mockAuthState.user = { id: 'u1', profile_completed: true };
    renderScreen();
    expect(mockRedirect).toHaveBeenCalledWith('/(tabs)/ankete');
  });
});
