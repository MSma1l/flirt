/**
 * Lista de evenimente (TZ secț. 8) pentru Mini App.
 *
 * PORT al lui `mobile/app/events/index.tsx`. Diferențele față de mobil sunt doar
 * de platformă:
 *   - `FlatList` → `<ul>`: lista de evenimente e scurtă (un oraș, câteva
 *     evenimente pe lună), deci virtualizarea nu-și merită complexitatea;
 *   - `Pressable` + `router.push` → `<Link>`: în DOM, navigarea trebuie să fie
 *     o ancoră reală, altfel se pierd apăsarea lungă, focusul de tastatură și
 *     rolul de link pentru cititoarele de ecran;
 *   - fără `BackButton`: cadrul (`DeepScreen`/`AppShell`) e pus de `routes.tsx`,
 *     ecranul randează DOAR conținut.
 *
 * Stările sunt ONESTE, ca peste tot în Mini App: încărcare vizibilă, eroare cu
 * reîncercare, listă goală cu explicație. Un ecran alb nu spune nimic.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { PASSPORT_PATH } from '@/features/passport/passportRoutes';

import { EventCard } from './EventCard';
import { eventPath } from './eventRoutes';
import { fetchEvents, type EventItem } from './eventsApi';

import './events.css';

export function EventsScreen() {
  const { data, isPending, isError, refetch, isFetching } = useQuery<EventItem[]>({
    queryKey: ['events'],
    queryFn: fetchEvents,
  });

  const events = data ?? [];

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="ev-state">
        <div className="spinner" role="status" aria-label="Evenimente" />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="ev-state" data-testid="events-error">
        <p className="error-text">Nu am putut încărca evenimentele.</p>
        <button
          type="button"
          className="button button--ghost"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          Reîncearcă
        </button>
      </div>
    );
  } else if (events.length === 0) {
    body = (
      <div className="ev-state" data-testid="events-empty">
        <p className="body-text">Niciun eveniment momentan — revino curând!</p>
      </div>
    );
  } else {
    body = (
      <ul className="ev-list__items">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              className="ev-list__link"
              to={eventPath(event.id)}
              aria-label={`Deschide ${event.title}`}
            >
              <EventCard event={event} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="ev-list">
      <div className="ev-list__header">
        <h1 className="title">Evenimente</h1>
        <Link className="ev-list__passport" to={PASSPORT_PATH}>
          Flirt Passport ›
        </Link>
      </div>
      {body}
    </div>
  );
}

export default EventsScreen;
