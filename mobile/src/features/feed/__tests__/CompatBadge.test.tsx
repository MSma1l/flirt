import { render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';
import { darkTheme, lightTheme } from '@theme/colors';

import { CompatBadge } from '../CompatBadge';

function renderBadge(score: number) {
  return render(
    <ThemeProvider>
      <CompatBadge score={score} />
    </ThemeProvider>,
  );
}

/** Aplatizează stilul unui element într-un singur obiect. */
function flat(el: { props: { style: unknown } }): Record<string, unknown> {
  const raw = el.props.style;
  const arr = Array.isArray(raw) ? raw.flat(Infinity) : [raw];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe('CompatBadge', () => {
  it('afișează procentul', () => {
    const { getByText } = renderBadge(87);
    expect(getByText('87%')).toBeTruthy();
  });

  it('scor > 80 → verde (success) + etichetă „excelentă"', () => {
    const { getByLabelText } = renderBadge(90);
    const badge = getByLabelText('Potrivire excelentă: 90%');
    expect([darkTheme.success, lightTheme.success]).toContain(flat(badge).backgroundColor);
  });

  it('scor 50–80 → galben (warning) + etichetă „bună"', () => {
    const { getByLabelText } = renderBadge(65);
    const badge = getByLabelText('Potrivire bună: 65%');
    expect([darkTheme.warning, lightTheme.warning]).toContain(flat(badge).backgroundColor);
  });

  it('scor < 50 → gri (textDisabled) + etichetă „slabă"', () => {
    const { getByLabelText } = renderBadge(30);
    const badge = getByLabelText('Potrivire slabă: 30%');
    expect([darkTheme.textDisabled, lightTheme.textDisabled]).toContain(
      flat(badge).backgroundColor,
    );
  });
});
