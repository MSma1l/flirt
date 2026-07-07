import { render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { EventCard, formatEventDate, kindColor, kindLabel } from '../EventCard';
import { EventItem } from '../types';
import { darkTheme } from '@theme/colors';

function makeEvent(over: Partial<EventItem> = {}): EventItem {
  return {
    id: 'e1',
    title: 'Flirt Party Chișinău',
    description: 'Seară de dating live',
    startsAt: '2026-07-10T19:00:00Z',
    city: 'Chișinău',
    venue: 'Club Nova',
    kind: 'flirt_party',
    attendeeCount: 42,
    iAmGoing: false,
    ...over,
  };
}

function renderCard(event: EventItem) {
  return render(
    <ThemeProvider>
      <EventCard event={event} />
    </ThemeProvider>,
  );
}

describe('EventCard', () => {
  it('afișează titlul și numărul de participanți', () => {
    const { getByText } = renderCard(makeEvent());
    expect(getByText('Flirt Party Chișinău')).toBeTruthy();
    expect(getByText('42 participanți')).toBeTruthy();
  });

  it('afișează indicatorul „Mergi" când iAmGoing este true', () => {
    const { getByText } = renderCard(makeEvent({ iAmGoing: true }));
    expect(getByText('Mergi')).toBeTruthy();
  });

  it('nu afișează indicatorul „Mergi" când iAmGoing este false', () => {
    const { queryByText } = renderCard(makeEvent({ iAmGoing: false }));
    expect(queryByText('Mergi')).toBeNull();
  });

  it('afișează data formatată și locul (venue · city)', () => {
    const { getByText } = renderCard(makeEvent());
    expect(getByText('Club Nova · Chișinău')).toBeTruthy();
    // Data formatată în ro-RO conține luna „iulie".
    expect(getByText(formatEventDate('2026-07-10T19:00:00Z'))).toBeTruthy();
  });

  it('afișează eticheta corectă pentru fiecare tip de eveniment', () => {
    expect(getByTextForKind('flirt_party')).toBe('Flirt Party');
    expect(getByTextForKind('concert')).toBe('Concert');
    expect(getByTextForKind('altceva')).toBe('Eveniment');

    function getByTextForKind(kind: string): string {
      const { getByText } = renderCard(makeEvent({ kind }));
      return getByText(kindLabel(kind)).props.children;
    }
  });
});

describe('EventCard helpers', () => {
  it('kindLabel mapează tipurile cunoscute și fallback', () => {
    expect(kindLabel('flirt_party')).toBe('Flirt Party');
    expect(kindLabel('concert')).toBe('Concert');
    expect(kindLabel('necunoscut')).toBe('Eveniment');
  });

  it('kindColor mapează tipurile la culori din temă', () => {
    expect(kindColor('flirt_party', darkTheme)).toBe(darkTheme.accent);
    expect(kindColor('concert', darkTheme)).toBe(darkTheme.link);
    expect(kindColor('necunoscut', darkTheme)).toBe(darkTheme.surfaceHover);
  });

  it('formatEventDate întoarce intrarea brută pentru o dată invalidă', () => {
    expect(formatEventDate('nu-e-dată')).toBe('nu-e-dată');
  });
});
