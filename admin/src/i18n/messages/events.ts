/**
 * Evenimente: ecranul `EventsPage` + validarea/avertismentele din `lib/eventForm.ts`.
 *
 * Textele cu parametri sunt funcții. Varianta română TREBUIE să rămână
 * identică cu cea de dinainte de traducere — testele afirmă exact aceste șiruri.
 */
import { defineMessages } from '../LanguageContext';

export const eventsMessages = defineMessages({
  ro: {
    filters: { all: 'Toate', upcoming: 'Viitoare', past: 'Trecute' },
    sorts: { soonest: 'Cele mai apropiate întâi', latest: 'Cele mai îndepărtate întâi' },
    searchLabel: 'Caută (titlu, oraș, loc, cod promo)',
    searchPlaceholder: 'flirt party, Chișinău, Club Nova…',
    periodLabel: 'Perioadă',
    sortLabel: 'Ordine',
    newEvent: 'Eveniment nou',
    listTitle: 'Evenimente',
    loading: 'Se încarcă evenimentele…',
    emptyTitle: 'Niciun eveniment',
    emptyHint: 'Creează primul eveniment — apare imediat în aplicația mobilă.',
    noMatchTitle: 'Niciun eveniment găsit',
    noMatchHint: 'Schimbă căutarea sau perioada selectată.',
    summary: (upcoming: number, past: number, total: number) =>
      `${upcoming} viitoare · ${past} trecute · ${total} în total`,
    sectionEmpty: 'Nimic aici.',
    deleteTitle: 'Șterge evenimentul',
    deleteConfirm: 'Șterge evenimentul',
    deleteGone: (title: string) => `„${title}" va dispărea din aplicație.`,
    deleteAttendees: (count: number) => `Participanți înscriși: ${count}.`,
    deleteApproved: (orders: number, approved: number) =>
      `Comenzi de bilet: ${orders}, dintre care ` +
      `${approved} BILETE APROBATE (plătite). Oamenii aceia au ` +
      'plătit: ștergerea le anulează biletul, fără rambursare automată.',
    deletePending: (orders: number) =>
      `Comenzi de bilet în așteptare: ${orders}. Dispar odată cu evenimentul.`,
    deleteNoOrders: 'Comenzi de bilet: niciuna.',
    table: {
      title: 'Titlu',
      when: 'Când',
      city: 'Oraș',
      venue: 'Locație',
      kind: 'Tip',
      ticketPrice: 'Preț bilet',
      attendees: 'Participanți',
      attendeesShown: (shown: number) => `afișat: ${shown}`,
      tickets: 'Bilete',
      actions: 'Acțiuni',
      promoFallback: 'Reducere la intrare',
      noMap: 'Fără hartă',
      noCover: 'Fără copertă',
      upcoming: 'Viitor',
      past: 'Trecut',
      ticketsTitle: 'Comenzi nerespinse (din care aprobate)',
      salesEnd: (when: string) => `Vânzare online până la ${when}`,
      priceFrom: (price: string) => `de la ${price}`,
      tierCount: (count: number) => (count === 1 ? '1 tip de bilet' : `${count} tipuri de bilet`),
      soldOf: (sold: number, capacity: number | null) =>
        `Vândute: ${sold} / ${capacity ?? 'nelimitat'}`,
      edit: 'Editează',
      invites: 'Invitații',
      delete: 'Șterge',
    },
    form: {
      editTitle: 'Editează evenimentul',
      newTitle: 'Eveniment nou',
      title: 'Titlu *',
      description: 'Descriere',
      startsAt: 'Data și ora *',
      kind: 'Tip',
      city: 'Oraș *',
      venue: 'Locație',
      mapLegend: 'Poziția pe hartă',
      mapHint:
        'Evenimentul apare pe harta din aplicație DOAR cu ambele coordonate. În Google ' +
        'Maps: clic dreapta pe loc → primul rând copiază „47.0245, 28.8322".',
      lat: 'Latitudine',
      lng: 'Longitudine',
      pasteCoords: 'Lipește „lat, lng" dintr-o dată',
      coordsOk: 'Coordonate valide — evenimentul apare pe hartă.',
      coordsMissing: 'Fără coordonate valide evenimentul NU apare pe harta din aplicație.',
      coverLegend: 'Imagine de copertă',
      coverHint:
        'Încarcă afișul de pe telefon sau calculator (JPG, PNG sau WEBP, maximum 8 MB) ' +
        'ori lipește un link public https.',
      coverUrl: 'URL copertă',
      cover: {
        upload: 'Încarcă imagine de pe dispozitiv',
        replace: 'Înlocuiește imaginea',
        uploading: 'Se încarcă imaginea…',
        remove: 'Șterge',
        removeLabel: 'Șterge coperta',
        preview: 'Previzualizarea copertei',
        badType: 'Acceptăm doar imagini JPG, PNG sau WEBP.',
        tooLarge: 'Imaginea e prea mare — maximum 8 MB.',
        unreadable: 'Fișierul e gol sau nu poate fi citit. Încearcă alt fișier.',
        pasteUrl: 'sau lipește un URL',
        uploadInProgress: 'Așteaptă să se termine încărcarea copertei.',
      },
      framing: {
        legend: 'Încadrarea posterului',
        hint:
          'Trage imaginea ca să alegi ce se vede, iar cu zoom-ul o mărești. Exact așa ' +
          'apare pe pagina evenimentului și pe cardul din listă.',
        frameLabel:
          'Încadrarea posterului. Trage cu mouse-ul sau cu degetul; săgețile mută imaginea.',
        zoom: 'Zoom',
        reset: 'Centrează',
        heroCaption: 'Pagina evenimentului',
        cardCaption: 'Cardul din listă',
        loading: 'Se încarcă imaginea…',
        broken: 'Imaginea nu se poate încărca — verifică adresa.',
      },
      ticketLegend: 'Bilet online',
      ticketPrice: 'Preț bilet',
      ticketPricePlaceholder: 'gol = bilet online indisponibil',
      currency: 'Monedă',
      salesEnd: 'Vânzarea online se închide la',
      salesEndHint: 'Gol = la începutul evenimentului',
      ticketCapacity: 'Capacitate totală',
      ticketCapacityPlaceholder: 'gol = nelimitat',
      ticketCapacityHint:
        'Câte bilete se pot vinde în total, din toate tipurile (comenzi + cereri). Gol = nelimitat.',
      attendeesLegend: 'Participanți afișați',
      displayedAttendees: 'Participanți afișați',
      displayedAttendeesPlaceholder: 'gol = numărul real',
      displayedAttendeesHint:
        'Numărul arătat tuturor în aplicație (card + pagina evenimentului). Se afișează ' +
        'cel MAI MARE dintre numărul real și cel setat aici — dacă se înscriu mai mulți ' +
        'oameni decât ai scris, aplicația arată numărul real. Gol = numărul real.',
      realAttendees: (real: number, shown: number) =>
        `Înscriși real: ${real} · afișat în aplicație: ${shown}`,
      tiers: {
        title: 'Tipuri de bilet',
        hint:
          'Până la 4 prețuri (ex. Early bird, Standard, VIP, La intrare). Utilizatorul alege ' +
          'tipul la cumpărare; cu un singur tip nu apare niciun pas în plus.',
        empty: 'Biletul online e dezactivat. Adaugă un tip de bilet ca să pornești vânzarea.',
        add: 'Adaugă tip de bilet',
        limit: (max: number) => `Maximum ${max} tipuri de bilet.`,
        row: (index: number) => `Tipul ${index}`,
        name: 'Nume',
        namePlaceholder: 'ex. Early bird',
        price: 'Preț',
        capacity: 'Locuri',
        capacityPlaceholder: 'gol = fără plafon',
        description: 'Descriere scurtă',
        descriptionPlaceholder: 'opțional, ex. Primele 50 de bilete',
        moveUp: 'Mută mai sus',
        moveDown: 'Mută mai jos',
        remove: 'Șterge tipul',
        sold: (sold: number, capacity: number | null) =>
          `Vândute: ${sold}${capacity === null ? '' : ` / ${capacity}`}`,
        removeSoldHint: 'Are bilete vândute — nu poate fi șters, doar modificat.',
      },
      soldOf: (sold: number, capacity: number | null) =>
        `Vândute: ${sold} / ${capacity ?? 'nelimitat'}`,
      promoLegend: 'Promo / Reducere la intrare',
      promoHint:
        'Aplicația arată blocul de promo doar când sunt completate AMBELE: procentul ' +
        'și codul.',
      promoPercent: 'Reducere (%)',
      promoPercentPlaceholder: 'ex. 10 — gol = fără reducere',
      promoCode: 'Cod promo',
      promoCodePlaceholder: 'ex. FLIRT10',
      promoDescription: 'Descriere promo',
      promoDescriptionPlaceholder: 'Arată acest cod la intrare pentru 10% reducere la bilet.',
      warningsTitle: 'Se poate publica, dar:',
      cancel: 'Anulează',
      saving: 'Se salvează…',
      save: 'Salvează',
      create: 'Creează evenimentul',
    },
    /** Erorile comune de text liber (`textProblem`), folosite și la fidelitate. */
    text: {
      tooLong: (label: string, max: number) => `${label}: maximum ${max} de caractere.`,
      html: (label: string) => `${label}: marcajele HTML nu sunt acceptate.`,
      control: (label: string) => `${label}: conține caractere nepermise.`,
    },
    fieldNames: {
      title: 'Titlu',
      city: 'Oraș',
      venue: 'Locație',
      description: 'Descriere',
      promoCode: 'Cod promo',
      promoDescription: 'Descriere promo',
      currency: 'Monedă',
      tierName: 'Numele tipului',
      tierDescription: 'Descrierea tipului',
    },
    validation: {
      titleRequired: 'Titlul este obligatoriu.',
      cityRequired: 'Orașul este obligatoriu.',
      startsRequired: 'Data și ora sunt obligatorii.',
      dateInvalid: 'Data introdusă nu este validă.',
      coverTooLong: (max: number) => `Adresa copertei: maximum ${max} de caractere.`,
      coverScheme: 'Adresa trebuie să înceapă cu http:// sau https://.',
      latRange: 'Latitudinea trebuie să fie un număr între −90 și 90.',
      lngRange: 'Longitudinea trebuie să fie un număr între −180 și 180.',
      lngMissing: 'Ai completat latitudinea — completeaz-o și pe cealaltă.',
      latMissing: 'Ai completat longitudinea — completeaz-o și pe cealaltă.',
      percentRange: 'Reducerea trebuie să fie între 0 și 100%.',
      percentInteger: 'Reducerea se exprimă în procente întregi.',
      priceNegative: 'Prețul biletului nu poate fi negativ.',
      priceTooHigh: 'Prețul pare greșit (maximum 1 000 000).',
      tierNameRequired: 'Numele tipului este obligatoriu.',
      tierNameDuplicate: 'Există deja un tip cu acest nume.',
      tierPriceRequired: 'Prețul este obligatoriu.',
      tiersMax: (max: number) => `Maximum ${max} tipuri de bilet.`,
      tiersInvalid: 'Corectează tipurile de bilet marcate.',
      tierInUseServer:
        'Un tip de bilet cu comenzi active nu poate fi șters. Respinge sau anulează întâi comenzile lui.',
      currencyRequired: 'Un preț fără monedă nu spune nimic.',
      salesEndTooLate:
        'Vânzarea online trebuie să se închidă cel târziu la 12 ore după începutul evenimentului.',
      capacityInteger: 'Capacitatea trebuie să fie un număr întreg de cel puțin 1 (sau gol = nelimitat).',
      displayedAttendeesInteger: 'Participanții afișați: un număr întreg între 0 și 100000 (sau gol = numărul real).',
      capacityBelowSold: (sold: number) =>
        `Capacitatea nu poate fi mai mică decât biletele deja vândute (${sold}).`,
      capacityBelowSoldServer:
        'Între timp s-au vândut mai multe bilete decât capacitatea aleasă. Mărește capacitatea (sau las-o goală = nelimitat).',
    },
    warnings: {
      noCoords:
        'Fără coordonate evenimentul NU apare pe harta din aplicație — doar în listă. ' +
        'Copiază latitudinea și longitudinea din Google Maps (clic dreapta pe loc → primul rând).',
      noCover:
        'Fără imagine de copertă cardul din aplicație rămâne un dreptunghi colorat, fără fotografie.',
      noVenue: 'Fără loc („Club Nova"), în aplicație se afișează doar orașul.',
      noDescription: 'Fără descriere, pagina evenimentului arată gol sub titlu.',
      percentWithoutCode:
        'Reducerea NU se afișează în aplicație fără cod promo — blocul de promo cere ambele.',
      codeWithoutPercent: 'Codul promo NU se afișează în aplicație fără procentul reducerii.',
      past: 'Data este în TRECUT — evenimentul nu apare în lista publică din aplicație.',
    },
  },
  ru: {
    filters: { all: 'Все', upcoming: 'Предстоящие', past: 'Прошедшие' },
    sorts: { soonest: 'Сначала ближайшие', latest: 'Сначала самые поздние' },
    searchLabel: 'Поиск (название, город, место, промокод)',
    searchPlaceholder: 'flirt party, Кишинёв, Club Nova…',
    periodLabel: 'Период',
    sortLabel: 'Порядок',
    newEvent: 'Новое событие',
    listTitle: 'События',
    loading: 'Загрузка событий…',
    emptyTitle: 'Нет событий',
    emptyHint: 'Создайте первое событие — оно сразу появится в мобильном приложении.',
    noMatchTitle: 'События не найдены',
    noMatchHint: 'Измените поисковый запрос или выбранный период.',
    summary: (upcoming: number, past: number, total: number) =>
      `предстоящих: ${upcoming} · прошедших: ${past} · всего: ${total}`,
    sectionEmpty: 'Здесь пусто.',
    deleteTitle: 'Удалить событие',
    deleteConfirm: 'Удалить событие',
    deleteGone: (title: string) => `«${title}» исчезнет из приложения.`,
    deleteAttendees: (count: number) => `Записавшихся участников: ${count}.`,
    deleteApproved: (orders: number, approved: number) =>
      `Заказов билетов: ${orders}, из них ` +
      `${approved} ОДОБРЕННЫХ БИЛЕТОВ (оплаченных). Эти люди ` +
      'заплатили: удаление аннулирует их билеты без автоматического возврата денег.',
    deletePending: (orders: number) =>
      `Заказов билетов в ожидании: ${orders}. Они исчезнут вместе с событием.`,
    deleteNoOrders: 'Заказов билетов: нет.',
    table: {
      title: 'Название',
      when: 'Когда',
      city: 'Город',
      venue: 'Место',
      kind: 'Тип',
      ticketPrice: 'Цена билета',
      attendees: 'Участники',
      attendeesShown: (shown: number) => `показ.: ${shown}`,
      tickets: 'Билеты',
      actions: 'Действия',
      promoFallback: 'Скидка на входе',
      noMap: 'Нет на карте',
      noCover: 'Без обложки',
      upcoming: 'Предстоит',
      past: 'Прошло',
      ticketsTitle: 'Неотклонённые заказы (из них одобренные)',
      salesEnd: (when: string) => `Онлайн-продажа до ${when}`,
      priceFrom: (price: string) => `от ${price}`,
      tierCount: (count: number) =>
        count === 1 ? '1 тип билета' : count < 5 ? `${count} типа билетов` : `${count} типов билетов`,
      soldOf: (sold: number, capacity: number | null) =>
        `Продано: ${sold} / ${capacity ?? 'без ограничений'}`,
      edit: 'Изменить',
      invites: 'Приглашения',
      delete: 'Удалить',
    },
    form: {
      editTitle: 'Редактирование события',
      newTitle: 'Новое событие',
      title: 'Название *',
      description: 'Описание',
      startsAt: 'Дата и время *',
      kind: 'Тип',
      city: 'Город *',
      venue: 'Место',
      mapLegend: 'Положение на карте',
      mapHint:
        'Событие появляется на карте в приложении ТОЛЬКО при обеих координатах. В Google ' +
        'Maps: правый клик по месту → первая строка копирует «47.0245, 28.8322».',
      lat: 'Широта',
      lng: 'Долгота',
      pasteCoords: 'Вставить «lat, lng» одной строкой',
      coordsOk: 'Координаты верны — событие появится на карте.',
      coordsMissing: 'Без верных координат событие НЕ появится на карте в приложении.',
      coverLegend: 'Обложка',
      coverHint:
        'Загрузите афишу с телефона или компьютера (JPG, PNG или WEBP, не более 8 МБ) ' +
        'или вставьте публичную https-ссылку.',
      coverUrl: 'URL обложки',
      cover: {
        upload: 'Загрузить изображение с устройства',
        replace: 'Заменить изображение',
        uploading: 'Загрузка изображения…',
        remove: 'Удалить',
        removeLabel: 'Удалить обложку',
        preview: 'Предпросмотр обложки',
        badType: 'Принимаем только изображения JPG, PNG или WEBP.',
        tooLarge: 'Изображение слишком большое — не более 8 МБ.',
        unreadable: 'Файл пустой или не читается. Попробуйте другой файл.',
        pasteUrl: 'или вставьте URL',
        uploadInProgress: 'Дождитесь окончания загрузки обложки.',
      },
      framing: {
        legend: 'Кадрирование афиши',
        hint:
          'Перетащите изображение, чтобы выбрать видимую часть, и увеличьте его зумом. ' +
          'Именно так оно будет выглядеть на странице события и в карточке списка.',
        frameLabel:
          'Кадрирование афиши. Перетаскивайте мышью или пальцем; стрелки сдвигают изображение.',
        zoom: 'Зум',
        reset: 'По центру',
        heroCaption: 'Страница события',
        cardCaption: 'Карточка в списке',
        loading: 'Загрузка изображения…',
        broken: 'Изображение не загружается — проверьте адрес.',
      },
      ticketLegend: 'Онлайн-билет',
      ticketPrice: 'Цена билета',
      ticketPricePlaceholder: 'пусто = онлайн-билет недоступен',
      currency: 'Валюта',
      salesEnd: 'Онлайн-продажа закрывается в',
      salesEndHint: 'Пусто = в момент начала события',
      ticketCapacity: 'Общая вместимость',
      ticketCapacityPlaceholder: 'пусто = без ограничений',
      ticketCapacityHint:
        'Сколько билетов можно продать всего, по всем типам (заказы + заявки). Пусто = без ограничений.',
      attendeesLegend: 'Показываемые участники',
      displayedAttendees: 'Показываемые участники',
      displayedAttendeesPlaceholder: 'пусто = реальное число',
      displayedAttendeesHint:
        'Число, которое все видят в приложении (карточка + страница события). ' +
        'Показывается БОЛЬШЕЕ из реального и указанного здесь — если запишется больше ' +
        'людей, чем вы указали, приложение покажет реальное число. Пусто = реальное число.',
      realAttendees: (real: number, shown: number) =>
        `Записались реально: ${real} · показывается в приложении: ${shown}`,
      tiers: {
        title: 'Типы билетов',
        hint:
          'До 4 цен (например Early bird, Standard, VIP, На входе). Пользователь выбирает ' +
          'тип при покупке; если тип один, лишнего шага нет.',
        empty: 'Онлайн-билет отключён. Добавьте тип билета, чтобы включить продажу.',
        add: 'Добавить тип билета',
        limit: (max: number) => `Не более ${max} типов билетов.`,
        row: (index: number) => `Тип ${index}`,
        name: 'Название',
        namePlaceholder: 'напр. Early bird',
        price: 'Цена',
        capacity: 'Мест',
        capacityPlaceholder: 'пусто = без лимита',
        description: 'Краткое описание',
        descriptionPlaceholder: 'необязательно, напр. Первые 50 билетов',
        moveUp: 'Выше',
        moveDown: 'Ниже',
        remove: 'Удалить тип',
        sold: (sold: number, capacity: number | null) =>
          `Продано: ${sold}${capacity === null ? '' : ` / ${capacity}`}`,
        removeSoldHint: 'Есть проданные билеты — тип нельзя удалить, только изменить.',
      },
      soldOf: (sold: number, capacity: number | null) =>
        `Продано: ${sold} / ${capacity ?? 'без ограничений'}`,
      promoLegend: 'Промо / Скидка на входе',
      promoHint:
        'Приложение показывает промоблок, только когда заполнены ОБА поля: процент ' +
        'и код.',
      promoPercent: 'Скидка (%)',
      promoPercentPlaceholder: 'напр. 10 — пусто = без скидки',
      promoCode: 'Промокод',
      promoCodePlaceholder: 'напр. FLIRT10',
      promoDescription: 'Описание промо',
      promoDescriptionPlaceholder: 'Покажите этот код на входе и получите скидку 10% на билет.',
      warningsTitle: 'Можно опубликовать, но:',
      cancel: 'Отмена',
      saving: 'Сохранение…',
      save: 'Сохранить',
      create: 'Создать событие',
    },
    text: {
      tooLong: (label: string, max: number) => `${label}: не более ${max} символов.`,
      html: (label: string) => `${label}: HTML-разметка не допускается.`,
      control: (label: string) => `${label}: содержит недопустимые символы.`,
    },
    fieldNames: {
      title: 'Название',
      city: 'Город',
      venue: 'Место',
      description: 'Описание',
      promoCode: 'Промокод',
      promoDescription: 'Описание промо',
      currency: 'Валюта',
      tierName: 'Название типа',
      tierDescription: 'Описание типа',
    },
    validation: {
      titleRequired: 'Название обязательно.',
      cityRequired: 'Город обязателен.',
      startsRequired: 'Дата и время обязательны.',
      dateInvalid: 'Введённая дата некорректна.',
      coverTooLong: (max: number) => `Адрес обложки: не более ${max} символов.`,
      coverScheme: 'Адрес должен начинаться с http:// или https://.',
      latRange: 'Широта должна быть числом от −90 до 90.',
      lngRange: 'Долгота должна быть числом от −180 до 180.',
      lngMissing: 'Вы указали широту — укажите и долготу.',
      latMissing: 'Вы указали долготу — укажите и широту.',
      percentRange: 'Скидка должна быть от 0 до 100%.',
      percentInteger: 'Скидка указывается в целых процентах.',
      priceNegative: 'Цена билета не может быть отрицательной.',
      priceTooHigh: 'Цена выглядит ошибочной (максимум 1 000 000).',
      tierNameRequired: 'Название типа обязательно.',
      tierNameDuplicate: 'Тип с таким названием уже есть.',
      tierPriceRequired: 'Цена обязательна.',
      tiersMax: (max: number) => `Не более ${max} типов билетов.`,
      tiersInvalid: 'Исправьте отмеченные типы билетов.',
      tierInUseServer:
        'Тип билета с активными заказами нельзя удалить. Сначала отклоните или отмените его заказы.',
      currencyRequired: 'Цена без валюты ничего не значит.',
      salesEndTooLate:
        'Онлайн-продажа должна закрываться не позднее чем через 12 часов после начала события.',
      capacityInteger: 'Вместимость — целое число не меньше 1 (или пусто = без ограничений).',
      displayedAttendeesInteger: 'Показываемые участники: целое число от 0 до 100000 (или пусто = реальное число).',
      capacityBelowSold: (sold: number) =>
        `Вместимость не может быть меньше уже проданных билетов (${sold}).`,
      capacityBelowSoldServer:
        'Тем временем продано больше билетов, чем выбранная вместимость. Увеличьте вместимость (или оставьте пустой = без ограничений).',
    },
    warnings: {
      noCoords:
        'Без координат событие НЕ появится на карте в приложении — только в списке. ' +
        'Скопируйте широту и долготу из Google Maps (правый клик по месту → первая строка).',
      noCover:
        'Без обложки карточка в приложении останется цветным прямоугольником без фотографии.',
      noVenue: 'Без места («Club Nova») в приложении отображается только город.',
      noDescription: 'Без описания страница события под названием выглядит пустой.',
      percentWithoutCode:
        'Скидка НЕ отображается в приложении без промокода — промоблоку нужны оба поля.',
      codeWithoutPercent: 'Промокод НЕ отображается в приложении без процента скидки.',
      past: 'Дата в ПРОШЛОМ — событие не появится в публичном списке приложения.',
    },
  },
});
