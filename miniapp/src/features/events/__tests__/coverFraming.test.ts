/**
 * Încadrarea copertei + maparea evenimentului (câmpurile noi de pe server).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ api: { get: vi.fn() } }));

import { coverImageStyle, normalizeFraming } from '../coverFraming';
import { mapEvent } from '../eventsApi';

describe('coverImageStyle', () => {
  it('fără încadrare: centru, fără zoom', () => {
    expect(coverImageStyle({})).toEqual({
      objectPosition: '50% 50%',
      transformOrigin: '50% 50%',
      transform: undefined,
    });
  });

  it('aplică punctul focal și zoom-ul în ACELAȘI punct', () => {
    expect(coverImageStyle({ coverFocusX: 0.2, coverFocusY: 0.75, coverZoom: 2 })).toEqual({
      objectPosition: '20% 75%',
      transformOrigin: '20% 75%',
      transform: 'scale(2)',
    });
  });

  it('valorile în afara intervalului sunt aduse în limite', () => {
    expect(normalizeFraming({ coverFocusX: -1, coverFocusY: 4, coverZoom: 9 })).toEqual({
      x: 0,
      y: 1,
      zoom: 3,
    });
    expect(normalizeFraming({ coverFocusX: Number.NaN, coverZoom: 0.2 })).toEqual({
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
  });
});

describe('mapEvent', () => {
  it('ia numărul AFIȘAT (`participants_count`) și încadrarea copertei', () => {
    const event = mapEvent({
      id: 'e1',
      title: 'Halloween',
      starts_at: '2027-10-31T19:00:00Z',
      city: 'Chișinău',
      kind: 'other',
      attendee_count: 3,
      participants_count: 120,
      cover_focus_x: 0.3,
      cover_focus_y: 0.6,
      cover_zoom: 1.4,
    });
    expect(event.attendeeCount).toBe(120);
    expect(event.coverFocusX).toBe(0.3);
    expect(event.coverFocusY).toBe(0.6);
    expect(event.coverZoom).toBe(1.4);
  });

  it('pe un server vechi cade pe `attendee_count` și pe încadrarea implicită', () => {
    const event = mapEvent({ id: 'e1', attendee_count: 7 });
    expect(event.attendeeCount).toBe(7);
    expect(event.coverFocusX).toBeNull();
    expect(event.coverZoom).toBeNull();
  });
});
