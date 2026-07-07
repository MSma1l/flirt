import { render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { EventCard } from '../EventCard';
import { EventItem } from '../types';

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
});
