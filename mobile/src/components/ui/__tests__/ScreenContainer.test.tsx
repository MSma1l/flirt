import { render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { ThemeProvider } from '@theme/index';

import { ScreenContainer } from '../ScreenContainer';

function renderScreen(props: Partial<React.ComponentProps<typeof ScreenContainer>> = {}) {
  return render(
    <ThemeProvider>
      <ScreenContainer {...props}>
        <Text>Conținut</Text>
      </ScreenContainer>
    </ThemeProvider>,
  );
}

describe('ScreenContainer', () => {
  it('randează copiii', () => {
    const { getByText } = renderScreen();
    expect(getByText('Conținut')).toBeTruthy();
  });

  it('funcționează și cu prop-ul center', () => {
    const { getByText } = renderScreen({ center: true });
    expect(getByText('Conținut')).toBeTruthy();
  });
});
