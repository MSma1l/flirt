import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Phone from '../phone';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Mock store: `useAuthStore(selector)` extrage câmpul cerut dintr-un state fals.
const mockRequestPhoneOtp = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockVerifyPhoneOtp = jest.fn<Promise<void>, [string, string]>(() => Promise.resolve());
jest.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (s: {
      requestPhoneOtp: typeof mockRequestPhoneOtp;
      verifyPhoneOtp: typeof mockVerifyPhoneOtp;
    }) => unknown,
  ) =>
    selector({
      requestPhoneOtp: mockRequestPhoneOtp,
      verifyPhoneOtp: mockVerifyPhoneOtp,
    }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <Phone />
    </ThemeProvider>,
  );
}

describe('Phone', () => {
  beforeEach(() => {
    mockRequestPhoneOtp.mockClear();
    mockVerifyPhoneOtp.mockClear();
  });

  it('cere OTP cu un telefon valid, apoi verifică cu codul introdus', async () => {
    const { getByTestId } = renderScreen();

    fireEvent.changeText(getByTestId('phone-input'), '+40700000000');
    fireEvent.press(getByTestId('phone-request'));

    await waitFor(() => {
      expect(mockRequestPhoneOtp).toHaveBeenCalledWith('+40700000000');
    });

    // După request, apare pasul de cod.
    fireEvent.changeText(getByTestId('phone-code'), '000000');
    fireEvent.press(getByTestId('phone-verify'));

    await waitFor(() => {
      expect(mockVerifyPhoneOtp).toHaveBeenCalledWith('+40700000000', '000000');
    });
  });

  it('NU cere OTP când telefonul este gol', () => {
    const { getByTestId } = renderScreen();

    fireEvent.changeText(getByTestId('phone-input'), '');
    fireEvent.press(getByTestId('phone-request'));

    expect(mockRequestPhoneOtp).not.toHaveBeenCalled();
  });
});
