import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { Button } from '../Button';

function renderButton(props: Partial<React.ComponentProps<typeof Button>> = {}) {
  return render(
    <ThemeProvider>
      <Button label="Continuă" {...props} />
    </ThemeProvider>,
  );
}

/** Aplatizează stilul (posibil funcție de state) al unui element și-l unește. */
function flatStyle(el: { props: { style: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof el.props.style === 'function'
      ? (el.props.style as (s: { pressed: boolean }) => unknown)({ pressed })
      : el.props.style;
  const arr = Array.isArray(raw) ? raw.flat(Infinity) : [raw];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe('Button', () => {
  it('randează label-ul și apelează onPress la apăsare', () => {
    const onPress = jest.fn();
    const { getByText } = renderButton({ onPress });
    fireEvent.press(getByText('Continuă'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('label-ul folosește fontul bold', () => {
    const { getByText } = renderButton();
    const style = flatStyle(getByText('Continuă'));
    expect(style.fontFamily).toBeTruthy();
    expect(String(style.fontFamily).toLowerCase()).toContain('bold');
  });

  it('varianta primary are fundal (backgroundColor setat)', () => {
    const { getByTestId } = renderButton({ variant: 'primary', testID: 'btn' });
    expect(flatStyle(getByTestId('btn')).backgroundColor).toBeTruthy();
  });

  it('varianta outline are border (borderWidth > 0)', () => {
    const { getByTestId } = renderButton({ variant: 'outline', testID: 'btn' });
    expect(flatStyle(getByTestId('btn')).borderWidth).toBeGreaterThan(0);
  });

  it('varianta ghost este transparentă și fără border', () => {
    const { getByTestId } = renderButton({ variant: 'ghost', testID: 'btn' });
    const style = flatStyle(getByTestId('btn'));
    expect(style.borderWidth).toBe(0);
    expect(style.backgroundColor).toBe('transparent');
  });

  it('disabled: nu apelează onPress și marchează starea de accesibilitate', () => {
    const onPress = jest.fn();
    const { getByTestId } = renderButton({ onPress, disabled: true, testID: 'btn' });
    const btn = getByTestId('btn');
    expect(btn.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading: afișează spinner în loc de label și blochează apăsarea', () => {
    const onPress = jest.fn();
    const { getByTestId, queryByText } = renderButton({
      onPress,
      loading: true,
      testID: 'btn',
    });
    const btn = getByTestId('btn');
    expect(btn.props.accessibilityState.busy).toBe(true);
    expect(queryByText('Continuă')).toBeNull();
    fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});
