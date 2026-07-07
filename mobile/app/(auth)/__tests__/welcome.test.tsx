import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import Welcome from '../welcome';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <Welcome />
    </ThemeProvider>,
  );
}

describe('Welcome', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('randează brandul și acțiunile', () => {
    const { getByText } = renderScreen();
    expect(getByText('FLIRT')).toBeTruthy();
    expect(getByText('No Regrets')).toBeTruthy();
    expect(getByText('Creează cont')).toBeTruthy();
    expect(getByText('Am deja cont')).toBeTruthy();
  });

  it('„Creează cont" navighează la register', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Creează cont'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/register');
  });

  it('„Am deja cont" navighează la login', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Am deja cont'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
  });
});
