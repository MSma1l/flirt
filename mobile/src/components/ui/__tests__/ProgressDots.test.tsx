import { render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';
import { darkTheme, lightTheme } from '@theme/colors';

import { ProgressDots } from '../ProgressDots';

/** Randează și întoarce nodurile-punct (copiii View-ului rând). */
function renderDots(total: number, current: number) {
  const tree = render(
    <ThemeProvider>
      <ProgressDots total={total} current={current} />
    </ThemeProvider>,
  ).toJSON();
  // `toJSON` întoarce View-ul rând; copiii sunt punctele.
  const root = Array.isArray(tree) ? tree[0] : tree;
  const dots = (root?.children ?? []) as { props: { style: Record<string, unknown> } }[];
  return dots;
}

describe('ProgressDots', () => {
  it('randează numărul corect de puncte', () => {
    expect(renderDots(4, 1)).toHaveLength(4);
    expect(renderDots(1, 0)).toHaveLength(1);
  });

  it('punctul activ (current) este colorat cu accent, cele viitoare cu border', () => {
    const dots = renderDots(3, 1);
    // current = 1 → accent (i <= current); accent e identic în ambele teme.
    expect(dots[1].props.style.backgroundColor).toBe(darkTheme.accent);
    // i = 2 > current → border (inactiv), poate fi din tema light sau dark.
    expect([darkTheme.border, lightTheme.border]).toContain(dots[2].props.style.backgroundColor);
  });

  it('punctul curent este mai lat decât cele inactive', () => {
    const dots = renderDots(3, 0);
    expect(dots[0].props.style.width).toBeGreaterThan(dots[1].props.style.width as number);
  });
});
