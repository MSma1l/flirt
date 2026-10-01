/**
 * Nucleul panoului: primitivele de UI, dialogurile comune, login, panoul de
 * bord, moderarea și previzualizarea evenimentului.
 */
import { formatNumber } from '../../lib/format';
import { defineMessages } from '../LanguageContext';

/** Pluralul rusesc: 1 жалоба, 2 жалобы, 5 жалоб (11–14 → forma „many"). */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const coreMessages = defineMessages({
  ro: {
    ui: {
      loading: 'Se încarcă',
      loadingEllipsis: 'Se încarcă…',
      errorTitle: 'Ceva n-a mers',
      retry: 'Reîncearcă',
    },
    confirm: {
      reasonPlaceholder: 'Motivul intră în jurnalul de audit',
      phraseLabel: (phrase: string) =>
        `Scrie „${phrase}" ca să confirmi. Acțiunea este IREVERSIBILĂ.`,
      cancel: 'Anulează',
      busy: 'Se execută…',
    },
    copy: {
      label: 'Copiază',
      done: 'Copiat!',
      failed: 'Nu s-a putut copia',
    },
    login: {
      forbidden:
        'Contul există, dar nu are drepturi de administrator. Cere-i unui admin să îți acorde rolul „admin".',
      badCredentials: 'Email sau parolă greșite.',
      rateLimited: 'Prea multe încercări de autentificare. Așteaptă un minut și încearcă din nou.',
      offline: 'Serverul nu răspunde. Verifică conexiunea sau adresa API-ului.',
      failed: 'Autentificare eșuată. Încearcă din nou.',
      subtitle: 'Acces rezervat conturilor cu rol de administrator.',
      email: 'Email',
      password: 'Parolă',
      submitting: 'Se autentifică…',
      submit: 'Intră în panou',
      themeLight: 'Temă deschisă',
      themeDark: 'Temă întunecată',
    },
    dashboard: {
      loading: 'Se încarcă statisticile…',
      users: 'Utilizatori',
      usersNew: (n: number) => `${formatNumber(n)} noi în 7 zile`,
      active: 'Activi (24h)',
      banned: (n: number) => `${formatNumber(n)} conturi banate`,
      matches: 'Match-uri',
      matches24h: (n: number) => `${formatNumber(n)} în ultimele 24h`,
      reportsPending: 'Rapoarte în așteptare',
      reportsHint: 'Termen de răspuns: 24h',
      subscriptions: 'Abonamente active',
      revenue: 'Venit estimat',
      revenueHint: 'Estimare pe baza abonamentelor active',
      trend: 'Evoluție',
      range: 'Interval',
      lastDays: (n: number) => `Ultimele ${n} zile`,
      chartUsers: 'Utilizatori noi / zi',
      chartMatches: 'Match-uri și rapoarte / zi',
      seriesUsers: 'Utilizatori',
      seriesMatches: 'Match-uri',
      seriesReports: 'Rapoarte',
    },
    moderation: {
      actions: {
        ban: {
          title: 'Banează contul raportat',
          message:
            'Contul va fi banat: nu se mai poate autentifica, iar profilul dispare din feed. Acțiunea poate fi anulată ulterior din ecranul Utilizatori (deban).',
          confirm: 'Banează contul',
        },
        hide: {
          title: 'Ascunde profilul',
          message:
            'Profilul nu va mai apărea în feed, dar contul rămâne activ. Folosește-o când conținutul e problematic, dar nu justifică un ban.',
          confirm: 'Ascunde profilul',
        },
        dismiss: {
          title: 'Respinge raportul',
          message:
            'Raportul se închide fără nicio măsură împotriva contului raportat. Rămâne în jurnalul de audit.',
          confirm: 'Respinge raportul',
        },
      },
      loading: 'Se încarcă coada de moderare…',
      emptyTitle: 'Coada e goală',
      emptyHint: 'Nu există rapoarte în așteptare. Rapoartele noi apar aici automat.',
      openReports: (n: number) => `Rapoarte deschise (${n})`,
      unknownProfile: 'Profil necunoscut',
      reportsCount: (n: number) => `${n} raportări`,
      loadingMore: 'Se încarcă…',
      loadMore: 'Încarcă mai multe',
      reportedProfile: 'Profil raportat',
      name: 'Nume',
      email: 'Email',
      ageCity: 'Vârstă / oraș',
      about: 'Descriere',
      category: 'Motiv raport',
      note: 'Nota raportorului',
      reporters: 'Raportări distincte',
      receivedAt: 'Primit la',
      accountState: 'Stare cont',
      banned: 'Banat',
      active: 'Activ',
      photoAlt: 'Fotografie din profilul raportat',
      reasonLabel: 'Motiv (opțional)',
    },
    eventPreview: {
      kinds: {
        flirt_party: 'Flirt Party',
        party: 'Petrecere',
        concert: 'Concert',
        bar: 'Bar',
        sport: 'Sport',
        culture: 'Cultură',
        other: 'Altele',
      } as Record<string, string>,
      noDate: 'Data nu e completată',
      ariaLabel: 'Previzualizare aplicație',
      hint: 'Așa ajunge evenimentul la utilizatori. Ordinea câmpurilor e cea din aplicație.',
      listPane: 'În listă (cardul de eveniment)',
      coverBroken: 'Adresa nu întoarce o imagine',
      noCover: 'Fără copertă',
      titlePlaceholder: 'Titlul evenimentului',
      cityPlaceholder: 'Oraș',
      attendees: (n: number) => `${n} participanți`,
      detailPane: 'Pagina evenimentului',
      noDescription: '(fără descriere)',
      promo: (percent: number) => `−${percent}% la intrare`,
      buyTicket: (price: number, currency: string) => `Cumpără bilet — ${price} ${currency}`,
      onMap: 'Apare pe harta din aplicație',
      noCoords:
        'Fără coordonate: în locul hărții rămâne doar numele orașului, iar evenimentul NU apare pe hartă.',
      going: 'Merg',
      checkIn: 'Check-in',
    },
  },
  ru: {
    ui: {
      loading: 'Загрузка',
      loadingEllipsis: 'Загрузка…',
      errorTitle: 'Что-то пошло не так',
      retry: 'Повторить',
    },
    confirm: {
      reasonPlaceholder: 'Причина попадёт в журнал аудита',
      phraseLabel: (phrase: string) =>
        `Введите «${phrase}», чтобы подтвердить. Действие НЕОБРАТИМО.`,
      cancel: 'Отмена',
      busy: 'Выполняется…',
    },
    copy: {
      label: 'Копировать',
      done: 'Скопировано!',
      failed: 'Не удалось скопировать',
    },
    login: {
      forbidden:
        'Аккаунт существует, но у него нет прав администратора. Попросите администратора выдать вам роль «admin».',
      badCredentials: 'Неверный email или пароль.',
      rateLimited: 'Слишком много попыток входа. Подождите минуту и попробуйте снова.',
      offline: 'Сервер не отвечает. Проверьте подключение или адрес API.',
      failed: 'Не удалось войти. Попробуйте снова.',
      subtitle: 'Доступ только для аккаунтов с ролью администратора.',
      email: 'Email',
      password: 'Пароль',
      submitting: 'Вход…',
      submit: 'Войти в панель',
      themeLight: 'Светлая тема',
      themeDark: 'Тёмная тема',
    },
    dashboard: {
      loading: 'Загрузка статистики…',
      users: 'Пользователи',
      usersNew: (n: number) => `+${formatNumber(n)} за 7 дней`,
      active: 'Активные (24 ч)',
      banned: (n: number) => `Заблокировано: ${formatNumber(n)}`,
      matches: 'Мэтчи',
      matches24h: (n: number) => `${formatNumber(n)} за последние 24 ч`,
      reportsPending: 'Жалобы в ожидании',
      reportsHint: 'Срок ответа: 24 ч',
      subscriptions: 'Активные подписки',
      revenue: 'Ожидаемый доход',
      revenueHint: 'Оценка на основе активных подписок',
      trend: 'Динамика',
      range: 'Период',
      lastDays: (n: number) => `Последние ${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
      chartUsers: 'Новые пользователи / день',
      chartMatches: 'Мэтчи и жалобы / день',
      seriesUsers: 'Пользователи',
      seriesMatches: 'Мэтчи',
      seriesReports: 'Жалобы',
    },
    moderation: {
      actions: {
        ban: {
          title: 'Заблокировать аккаунт',
          message:
            'Аккаунт будет заблокирован: войти в него будет нельзя, а профиль исчезнет из ленты. Действие можно отменить позже на экране «Пользователи» (разблокировка).',
          confirm: 'Заблокировать аккаунт',
        },
        hide: {
          title: 'Скрыть профиль',
          message:
            'Профиль больше не будет показываться в ленте, но аккаунт останется активным. Используйте, когда контент проблемный, но не заслуживает блокировки.',
          confirm: 'Скрыть профиль',
        },
        dismiss: {
          title: 'Отклонить жалобу',
          message:
            'Жалоба закрывается без каких-либо мер против аккаунта. Запись остаётся в журнале аудита.',
          confirm: 'Отклонить жалобу',
        },
      },
      loading: 'Загрузка очереди модерации…',
      emptyTitle: 'Очередь пуста',
      emptyHint: 'Ожидающих жалоб нет. Новые жалобы появятся здесь автоматически.',
      openReports: (n: number) => `Открытые жалобы (${n})`,
      unknownProfile: 'Неизвестный профиль',
      reportsCount: (n: number) => `${n} ${ruPlural(n, 'жалоба', 'жалобы', 'жалоб')}`,
      loadingMore: 'Загрузка…',
      loadMore: 'Загрузить ещё',
      reportedProfile: 'Профиль, на который пожаловались',
      name: 'Имя',
      email: 'Email',
      ageCity: 'Возраст / город',
      about: 'Описание',
      category: 'Причина жалобы',
      note: 'Комментарий автора жалобы',
      reporters: 'Уникальных жалоб',
      receivedAt: 'Получено',
      accountState: 'Статус аккаунта',
      banned: 'Заблокирован',
      active: 'Активен',
      photoAlt: 'Фото из профиля, на который пожаловались',
      reasonLabel: 'Причина (необязательно)',
    },
    eventPreview: {
      kinds: {
        flirt_party: 'Flirt Party',
        party: 'Вечеринка',
        concert: 'Концерт',
        bar: 'Бар',
        sport: 'Спорт',
        culture: 'Культура',
        other: 'Другое',
      },
      noDate: 'Дата не указана',
      ariaLabel: 'Предпросмотр в приложении',
      hint: 'Так событие увидят пользователи. Порядок полей — как в приложении.',
      listPane: 'В списке (карточка события)',
      coverBroken: 'По этому адресу нет изображения',
      noCover: 'Без обложки',
      titlePlaceholder: 'Название события',
      cityPlaceholder: 'Город',
      attendees: (n: number) =>
        `${n} ${ruPlural(n, 'участник', 'участника', 'участников')}`,
      detailPane: 'Страница события',
      noDescription: '(без описания)',
      promo: (percent: number) => `−${percent}% на вход`,
      buyTicket: (price: number, currency: string) => `Купить билет — ${price} ${currency}`,
      onMap: 'Отображается на карте в приложении',
      noCoords:
        'Нет координат: вместо карты будет только название города, и событие НЕ появится на карте.',
      going: 'Пойду',
      checkIn: 'Check-in',
    },
  },
});
