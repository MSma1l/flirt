/**
 * Scannerul de bilete de la intrare — pagină gândită pentru TELEFONUL staff-ului
 * (fără aplicație instalată: doar panoul de admin deschis în browser).
 *
 * Flux: alegi evenimentul → pornești camera → fiecare QR citit pleacă la
 * `POST /admin/tickets/scan`; rezultatul acoperă tot ecranul (verde = intră,
 * roșu = motivul refuzului), cu vibrație + bip, și dispare singur după ~3 s sau
 * la atingere. Backend-ul face admiterea ATOMIC — două telefoane care scanează
 * același bilet nu pot admite de două ori.
 *
 * Camera: `getUserMedia` (camera din spate) + `BarcodeDetector` când există,
 * altfel `jsqr` pe cadre din canvas (vezi `lib/qrDecoder.ts`). Merge doar pe
 * HTTPS — erorile de permisiune primesc instrucțiuni clare.
 *
 * Flirt Passport: QR-ul personal din aplicație trece prin același endpoint. Cu
 * bilet online → admis ca bilet (`via: "passport"`). Fără bilet → `no_ticket`
 * (card chihlimbariu, NU dispare singur): staff-ul încasează cash și apasă
 * „Achitat cash" → `POST /admin/events/{id}/door-admissions` cu același cod.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  admitDoorCash,
  fetchAdmissions,
  fetchEvents,
  fetchScanStats,
  scanTicket,
} from '../api/admin';
import type { AdminEvent, TicketScanResponse } from '../api/types';
import { Button, Card, EmptyState, Field, LoadingState, Select, TextInput } from '../components/ui';
import { INTL_LOCALE, useLanguage, useMessages } from '../i18n/LanguageContext';
import { scanMessages } from '../i18n/messages/scan';
import { errorMessage } from '../lib/errors';
import { createQrDecoder, type QrDecoder } from '../lib/qrDecoder';
import './ScanPage.css';

/** Cât stă cardul de rezultat pe ecran înainte de revenirea la scanare. */
export const RESULT_DISPLAY_MS = 3000;
/** Același cod nu e retrimis mai des de atât (QR-ul rămâne în fața camerei). */
export const SAME_CODE_COOLDOWN_MS = 2000;
/** Pauza dintre două încercări de decodare (cadre/s ≈ 1000 / valoare). */
const DECODE_INTERVAL_MS = 150;
/** Durata presupusă a unui eveniment (aliniată cu backend-ul: starts_at + 12h). */
const EVENT_DURATION_MS = 12 * 60 * 60 * 1000;
const EVENT_STORAGE_KEY = 'flirt_admin_scan_event';

type CameraState =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'notFound'
  | 'busy'
  | 'generic';

type ShownResult = TicketScanResponse | { result: 'error'; ticket: null; message: string };

/* ------------------------------ Feedback ------------------------------ */

let audioContext: AudioContext | null = null;

/** Creat la un gest al userului (iOS nu pornește audio altfel). */
function unlockAudio(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    void audioContext.resume?.();
  } catch {
    audioContext = null;
  }
}

function beep(ok: boolean): void {
  try {
    if (!audioContext) return;
    const tones = ok ? [[880, 0, 0.15]] : [[260, 0, 0.18], [200, 0.22, 0.3]];
    for (const [freq, start, duration] of tones as [number, number, number][]) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.value = freq;
      const t0 = audioContext.currentTime + start;
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(t0);
      osc.stop(t0 + duration);
    }
  } catch {
    // Sunetul e un bonus — nu blocăm niciodată scanarea pentru el.
  }
}

function vibrate(ok: boolean): void {
  try {
    navigator.vibrate?.(ok ? 150 : [90, 60, 90, 60, 90]);
  } catch {
    // iOS Safari nu are vibrate — ignorăm.
  }
}

/* ------------------------------ Evenimente ------------------------------ */

function eventEndsAt(event: AdminEvent): number {
  return new Date(event.starts_at).getTime() + EVENT_DURATION_MS;
}

/** Evenimentele încă neîncheiate, cele mai apropiate primele (azi sus). */
function scannableEvents(events: AdminEvent[], now: number): AdminEvent[] {
  return events
    .filter((event) => eventEndsAt(event) > now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}

function readStoredEvent(): string | null {
  try {
    return window.localStorage.getItem(EVENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeEvent(id: string): void {
  try {
    window.localStorage.setItem(EVENT_STORAGE_KEY, id);
  } catch {
    // Preferință opțională.
  }
}

/* ------------------------------ Camera ------------------------------ */

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

function cameraErrorState(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'notFound';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  return 'generic';
}

function useQrCamera(onCode: (code: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<CameraState>('idle');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchSupported(false);
    setState((current) => (current === 'scanning' || current === 'starting' ? 'idle' : current));
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    if (window.isSecureContext === false) {
      setState('insecure');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (error) {
      setState(cameraErrorState(error));
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((track) => track.stop());
      setState('idle');
      return;
    }
    // iOS: fără `playsinline` + `muted` video-ul pornește doar pe tot ecranul.
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Unele browsere resping `play()` deși redarea pornește; continuăm.
    }

    const track = stream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
    setTorchSupported(Boolean(capabilities?.torch));

    let decoder: QrDecoder;
    try {
      decoder = await createQrDecoder();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setState('generic');
      return;
    }

    runningRef.current = true;
    setState('scanning');
    const tick = async (): Promise<void> => {
      if (!runningRef.current) return;
      try {
        if (video.readyState >= 2) {
          const code = await decoder.decode(video);
          if (code && runningRef.current) onCodeRef.current(code);
        }
      } catch {
        // Un cadru nedecodabil nu oprește scanarea.
      }
      if (runningRef.current) timerRef.current = window.setTimeout(() => void tick(), DECODE_INTERVAL_MS);
    };
    void tick();
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  // Oprim camera la părăsirea paginii (altfel LED-ul camerei rămâne aprins).
  useEffect(() => stop, [stop]);

  return { videoRef, state, start, stop, torchSupported, torchOn, toggleTorch };
}

/* ------------------------------ Pagina ------------------------------ */

export function ScanPage(): JSX.Element {
  const m = useMessages(scanMessages);
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [eventId, setEventId] = useState<string | null>(readStoredEvent);
  const [shown, setShown] = useState<ShownResult | null>(null);
  const [manualCode, setManualCode] = useState('');
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);
  /** Codul (pașaportul) pentru care se poate înregistra intrarea cash. */
  const [cashCode, setCashCode] = useState<{ code: string; event: string } | null>(null);
  const cashBusyRef = useRef(false);

  const eventsQuery = useQuery({
    queryKey: ['scan-events'],
    queryFn: () => fetchEvents(),
    staleTime: 60_000,
  });
  const events = useMemo(
    () => scannableEvents(eventsQuery.data?.items ?? [], Date.now()),
    [eventsQuery.data],
  );
  // Evenimentul salvat dacă e încă valabil, altfel cel mai apropiat.
  const selected = events.find((event) => event.id === eventId) ?? events[0] ?? null;

  const statsQuery = useQuery({
    queryKey: ['scan-stats', selected?.id],
    queryFn: () => fetchScanStats(selected!.id),
    enabled: selected !== null,
    refetchInterval: 10_000,
  });
  const admissionsQuery = useQuery({
    queryKey: ['scan-admissions', selected?.id],
    queryFn: () => fetchAdmissions(selected!.id),
    enabled: selected !== null,
    refetchInterval: 15_000,
  });

  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(INTL_LOCALE[language], { hour: '2-digit', minute: '2-digit' }),
    [language],
  );
  const formatTime = (iso: string | null): string => (iso ? timeFormat.format(new Date(iso)) : '—');

  const refreshCounters = useCallback(
    (event: string) => {
      void queryClient.invalidateQueries({ queryKey: ['scan-stats', event] });
      void queryClient.invalidateQueries({ queryKey: ['scan-admissions', event] });
    },
    [queryClient],
  );

  const scanMutation = useMutation({
    mutationFn: ({ code, event }: { code: string; event: string }) => scanTicket(code, event),
    onSuccess: (data, variables) => {
      const ok = data.result === 'admitted';
      vibrate(ok);
      beep(ok);
      setCashCode(data.result === 'no_ticket' ? variables : null);
      setShown(data);
      refreshCounters(variables.event);
    },
    onError: (error) => {
      vibrate(false);
      beep(false);
      setShown({ result: 'error', ticket: null, message: errorMessage(error) });
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const cashMutation = useMutation({
    mutationFn: ({ code, event }: { code: string; event: string }) => admitDoorCash(event, code),
    onSuccess: (data, variables) => {
      const ok = data.result === 'admitted';
      vibrate(ok);
      beep(ok);
      setCashCode(null);
      setShown(data);
      refreshCounters(variables.event);
    },
    onError: (error) => {
      vibrate(false);
      beep(false);
      setCashCode(null);
      setShown({ result: 'error', ticket: null, message: errorMessage(error) });
    },
    onSettled: () => {
      cashBusyRef.current = false;
    },
  });

  const onPayCash = useCallback(() => {
    // Garda sincronă: un dublu-tap nu trimite două înregistrări.
    if (!cashCode || cashBusyRef.current) return;
    cashBusyRef.current = true;
    unlockAudio();
    cashMutation.mutate(cashCode);
  }, [cashCode, cashMutation]);

  const submitCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code || !selected || busyRef.current) return;
      busyRef.current = true;
      lastCodeRef.current = { code, at: Date.now() };
      scanMutation.mutate({ code, event: selected.id });
    },
    [scanMutation, selected],
  );

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const onCameraCode = useCallback(
    (code: string) => {
      // În pauză cât timp e afișat un rezultat sau o cerere e în zbor.
      if (shownRef.current || busyRef.current) return;
      const last = lastCodeRef.current;
      if (last && last.code === code && Date.now() - last.at < SAME_CODE_COOLDOWN_MS) return;
      submitCode(code);
    },
    [submitCode],
  );

  const camera = useQrCamera(onCameraCode);

  const dismiss = useCallback(() => {
    if (cashBusyRef.current) return;
    setShown(null);
    setCashCode(null);
    // Cooldown-ul pornește de la revenire: QR-ul încă ținut în fața camerei nu
    // re-declanșează imediat „deja intrat".
    if (lastCodeRef.current) lastCodeRef.current = { ...lastCodeRef.current, at: Date.now() };
  }, []);

  useEffect(() => {
    // „Fără bilet" așteaptă decizia staff-ului (încasează cash sau anulează).
    if (!shown || shown.result === 'no_ticket') return undefined;
    const timer = window.setTimeout(dismiss, RESULT_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [shown, dismiss]);

  const onSelectEvent = (id: string): void => {
    setEventId(id);
    storeEvent(id);
    lastCodeRef.current = null;
  };

  const onManualSubmit = (e: FormEvent): void => {
    e.preventDefault();
    unlockAudio();
    if (!manualCode.trim()) return;
    submitCode(manualCode);
    setManualCode('');
  };

  const onStartCamera = (): void => {
    unlockAudio();
    void camera.start();
  };

  const today = new Date().toDateString();
  const eventLabel = (event: AdminEvent): string => {
    const starts = new Date(event.starts_at);
    const when =
      starts.toDateString() === today
        ? `${m.today} ${timeFormat.format(starts)}`
        : new Intl.DateTimeFormat(INTL_LOCALE[language], {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(starts);
    return `${when} · ${event.title}`;
  };

  const cameraMessage =
    camera.state === 'idle' || camera.state === 'starting' || camera.state === 'scanning'
      ? null
      : m.camera[camera.state];

  if (eventsQuery.isLoading) return <LoadingState label={m.loadingEvents} />;

  return (
    <div className="scan">
      <Card title={m.title}>
        <p className="field__hint">{m.intro}</p>
        {events.length === 0 || !selected ? (
          <EmptyState title={m.noEvents} />
        ) : (
          <>
            <Field label={m.eventLabel} htmlFor="scan-event">
              <Select
                id="scan-event"
                value={selected.id}
                onChange={(e) => onSelectEvent(e.target.value)}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {eventLabel(event)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="scan__counter" aria-live="polite" data-testid="scan-counter">
              <span className="scan__counter-value">
                {statsQuery.data ? `${statsQuery.data.admitted} / ${statsQuery.data.sold}` : '— / —'}
              </span>
              <span className="scan__counter-label">{m.counterLabel}</span>
              {statsQuery.data && statsQuery.data.flirt_party_admitted > 0 ? (
                <span className="scan__counter-label">
                  {m.flirtParty(statsQuery.data.flirt_party_admitted)}
                </span>
              ) : null}
              {statsQuery.data && typeof statsQuery.data.door_admitted === 'number' ? (
                <span className="scan__counter-label" data-testid="scan-counter-cash">
                  {m.doorCash(statsQuery.data.door_admitted)}
                </span>
              ) : null}
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <>
          <Card>
            <div className="scan__viewport">
              <video ref={camera.videoRef} className="scan__video" playsInline muted />
              {camera.state === 'scanning' ? <div className="scan__frame" aria-hidden="true" /> : null}
              {camera.state !== 'scanning' ? (
                <div className="scan__placeholder">
                  {camera.state === 'starting' ? m.starting : null}
                </div>
              ) : null}
            </div>
            <p className="scan__status" aria-live="polite">
              {scanMutation.isPending
                ? m.checking
                : camera.state === 'scanning'
                  ? m.pointCamera
                  : null}
            </p>
            {cameraMessage ? (
              <p className="scan__camera-error" role="alert">
                {cameraMessage}
              </p>
            ) : null}
            <div className="scan__actions">
              {camera.state === 'scanning' || camera.state === 'starting' ? (
                <Button variant="ghost" block onClick={camera.stop}>
                  {m.stopCamera}
                </Button>
              ) : (
                <Button variant="primary" block onClick={onStartCamera}>
                  {m.startCamera}
                </Button>
              )}
              {camera.state === 'scanning' && camera.torchSupported ? (
                <Button variant="ghost" block onClick={() => void camera.toggleTorch()}>
                  {camera.torchOn ? m.torchOff : m.torchOn}
                </Button>
              ) : null}
            </div>
          </Card>

          <Card title={m.manualTitle}>
            <form className="scan__manual" onSubmit={onManualSubmit}>
              <Field label={m.manualHint} htmlFor="scan-manual">
                <TextInput
                  id="scan-manual"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={m.manualPlaceholder}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={128}
                  inputMode="text"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                block
                disabled={!manualCode.trim() || scanMutation.isPending}
              >
                {m.manualSubmit}
              </Button>
            </form>
          </Card>

          <Card title={m.recentTitle}>
            {admissionsQuery.data && admissionsQuery.data.length > 0 ? (
              <ul className="scan__recent">
                {admissionsQuery.data.map((row) => (
                  <li key={`${row.admitted_at}-${row.first_name ?? ''}`} className="scan__recent-item">
                    {row.photo_url ? (
                      <img className="scan__recent-photo" src={row.photo_url} alt="" />
                    ) : (
                      <span className="scan__recent-photo" aria-hidden="true" />
                    )}
                    <span className="scan__recent-name">
                      {row.first_name ?? '—'}
                      {row.age !== null ? `, ${row.age}` : ''}
                      {row.ticket_quantity > 1 ? ` ${m.persons(row.ticket_quantity)}` : ''}
                    </span>
                    {row.ticket_type === 'door_cash' ? (
                      <span className="scan__recent-tag">{m.recentCash}</span>
                    ) : null}
                    <span className="scan__recent-time">{formatTime(row.admitted_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{m.recentEmpty}</p>
            )}
          </Card>
        </>
      ) : null}

      {shown && shown.result === 'no_ticket' ? (
        <NoTicketOverlay
          shown={shown}
          messages={m}
          saving={cashMutation.isPending}
          onPayCash={onPayCash}
          onCancel={dismiss}
        />
      ) : shown ? (
        <ResultOverlay
          shown={shown}
          formatTime={formatTime}
          onDismiss={dismiss}
          messages={m}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ Cardul de rezultat ------------------------------ */

type ScanText = (typeof scanMessages)['ro'];

function reasonFor(shown: ShownResult, m: ScanText, formatTime: (iso: string | null) => string): string | null {
  if (shown.result === 'error') return shown.message;
  const ticket = shown.ticket;
  switch (shown.result) {
    case 'admitted':
      return null;
    case 'already_admitted':
      return ticket?.admitted_at
        ? m.reason.alreadyAdmitted(formatTime(ticket.admitted_at), ticket.admitted_by_email)
        : m.reason.alreadyUsed;
    case 'wrong_event':
      return m.reason.wrongEvent(ticket?.event_title ?? null);
    case 'not_paid':
      return m.reason.notPaid;
    case 'cancelled':
      return m.reason.cancelled;
    case 'event_over':
      return m.reason.eventOver;
    case 'not_found':
      return m.reason.notFound;
    case 'no_ticket':
      return m.noTicket.reason;
    default:
      return null;
  }
}

function ResultOverlay({
  shown,
  formatTime,
  onDismiss,
  messages: m,
}: {
  shown: ShownResult;
  formatTime: (iso: string | null) => string;
  onDismiss: () => void;
  messages: ScanText;
}): JSX.Element {
  const ok = shown.result === 'admitted';
  const ticket = shown.ticket;
  const reason = reasonFor(shown, m, formatTime);
  const sourceLine = sourceLineFor(shown, m);
  return (
    <button
      type="button"
      className={ok ? 'scan-result scan-result--ok' : 'scan-result scan-result--fail'}
      onClick={onDismiss}
      role="alert"
      data-testid="scan-result"
    >
      <span className="scan-result__icon" aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="scan-result__title">{m.result[shown.result]}</span>
      {ticket && (ticket.photo_url || ticket.first_name) ? (
        <span className="scan-result__person">
          {ticket.photo_url ? (
            <img className="scan-result__photo" src={ticket.photo_url} alt="" />
          ) : null}
          <span className="scan-result__name">
            {ticket.first_name ?? '—'}
            {ticket.age !== null ? `, ${m.ageSuffix(ticket.age)}` : ''}
          </span>
          {ticket.ticket_quantity > 1 ? (
            <span className="scan-result__qty">{m.persons(ticket.ticket_quantity)}</span>
          ) : null}
          {ticket.ticket_type === 'flirt_party' ? (
            <span className="scan-result__meta">{m.ticketFlirtParty}</span>
          ) : null}
        </span>
      ) : null}
      {sourceLine ? <span className="scan-result__source">{sourceLine}</span> : null}
      {reason ? <span className="scan-result__reason">{reason}</span> : null}
      <span className="scan-result__hint">{m.tapToContinue}</span>
    </button>
  );
}

/** De unde vine intrarea: cash la ușă sau biletul online găsit prin pașaport. */
function sourceLineFor(shown: ShownResult, m: ScanText): string | null {
  if (shown.result === 'error' || !shown.ticket) return null;
  if (shown.ticket.ticket_type === 'door_cash') {
    return shown.result === 'admitted' ? m.doorCashAdmitted : m.doorCashTicket;
  }
  if (shown.via === 'passport' && shown.result === 'admitted') return m.viaPassport;
  return null;
}

/**
 * Pașaport fără bilet online: cardul rămâne până la decizia staff-ului. Nu e
 * un singur buton-ecran (ca refuzurile) pentru că are două acțiuni distincte.
 */
function NoTicketOverlay({
  shown,
  messages: m,
  saving,
  onPayCash,
  onCancel,
}: {
  shown: TicketScanResponse;
  messages: ScanText;
  saving: boolean;
  onPayCash: () => void;
  onCancel: () => void;
}): JSX.Element {
  const ticket = shown.ticket;
  const discount = ticket?.discount_percent ?? 0;
  return (
    <div className="scan-result scan-result--warn" role="alert" data-testid="scan-result">
      <span className="scan-result__icon" aria-hidden="true">
        !
      </span>
      <span className="scan-result__title">{m.result.no_ticket}</span>
      {ticket && (ticket.photo_url || ticket.first_name) ? (
        <span className="scan-result__person">
          {ticket.photo_url ? (
            <img className="scan-result__photo" src={ticket.photo_url} alt="" />
          ) : null}
          <span className="scan-result__name">
            {ticket.first_name ?? '—'}
            {ticket.age !== null ? `, ${m.ageSuffix(ticket.age)}` : ''}
          </span>
        </span>
      ) : null}
      <span className="scan-result__reason">{m.noTicket.reason}</span>
      <span className="scan-result__loyalty">
        {typeof ticket?.stamps === 'number' ? <span>{m.noTicket.visits(ticket.stamps)}</span> : null}
        <span className="scan-result__discount">
          {discount > 0 ? m.noTicket.discount(discount) : m.noTicket.noDiscount}
        </span>
      </span>
      <button
        type="button"
        className="scan-result__cash"
        onClick={onPayCash}
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? m.noTicket.saving : m.noTicket.payCash}
      </button>
      <button type="button" className="scan-result__cancel" onClick={onCancel} disabled={saving}>
        {m.noTicket.cancel}
      </button>
    </div>
  );
}
