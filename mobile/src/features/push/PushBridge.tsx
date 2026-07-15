/**
 * Puntea dintre notificările sistemului și navigarea aplicației.
 *
 * Se montează o singură dată, în layout-ul rădăcină: aici se leagă handler-ul de
 * notificări primite, tap-ul pe notificare → ecranul potrivit, și sincronizarea
 * TĂCUTĂ a tokenului (fără dialog de permisiune — acela are locul lui, în
 * `usePushPermissionPrompt`).
 */
import * as Notifications from 'expo-notifications';
import { Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useAuthStore } from '@/store/authStore';

import { routeFromNotificationData } from './pushRouting';
import { ensureAndroidChannel, syncPushRegistration } from './pushService';

/**
 * Handler global, setat la import (așa cere expo-notifications: înainte ca
 * aplicația să apuce să primească ceva). Fără el, o notificare sosită cu
 * aplicația DESCHISĂ nu se afișează deloc pe iOS — userul aflat în feed n-ar
 * afla că i-a venit un mesaj decât intrând manual în tab-ul Mesaje.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // `shouldShowAlert` e depreciat în SDK 54; banner + listă îl înlocuiesc.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function PushBridge(): null {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  // Ruta cerută de o notificare, ținută până când userul e autentificat.
  const pendingRoute = useRef<Href | null>(null);
  // Un tap poate ajunge la noi de două ori (listener + „ultimul răspuns" la
  // cold-start). Reținem ce am tratat deja, ca să nu navigăm de două ori.
  const handledResponses = useRef<Set<string>>(new Set());

  const flush = useCallback(() => {
    const route = pendingRoute.current;
    // Navigăm doar pe sesiune validă: dacă notificarea deschide aplicația
    // înainte de hidratarea sesiunii, AuthGuard ne-ar arunca instant în (auth)
    // și tap-ul s-ar pierde. Așteptăm și navigăm după autentificare.
    if (!route || status !== 'authenticated') return;
    pendingRoute.current = null;
    router.push(route);
  }, [router, status]);

  // Ținem ultima versiune a lui `flush` într-un ref, ca listener-ul de notificări
  // să nu se re-atașeze la fiecare schimbare de sesiune. Efectul rulează și la
  // trecerea în `authenticated`, golind ruta rămasă în așteptare.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
    flush();
  }, [flush]);

  const consume = useCallback((response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (handledResponses.current.has(id)) return;
    handledResponses.current.add(id);

    const route = routeFromNotificationData(response.notification.request.content.data);
    // Payload fără destinație clară (azi backend-ul trimite doar title/body):
    // deschidem aplicația și atât, nu ghicim un ecran.
    if (!route) return;

    pendingRoute.current = route;
    flushRef.current();
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(consume);

    // Cold start: tap-ul a PORNIT aplicația, deci s-a consumat înainte ca
    // listener-ul de mai sus să existe. Îl recuperăm explicit.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) consume(response);
      })
      .catch(() => {
        // Fără răspuns recuperabil: aplicația a fost pornită normal.
      });

    return () => subscription.remove();
  }, [consume]);

  // Canalul Android trebuie să existe înainte de PRIMA notificare, indiferent
  // dacă permisiunea e deja acordată sau abia urmează să fie.
  useEffect(() => {
    void ensureAndroidChannel();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // Tăcut, fără dialog: reînnoiește înregistrarea când tokenul s-a schimbat
    // (reinstalare, restore) sau când userul a activat notificările din setările
    // sistemului, fără să mai treacă prin aplicație.
    void syncPushRegistration();
  }, [status]);

  return null;
}
