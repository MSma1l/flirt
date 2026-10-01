/**
 * Fidelitate: ecranul `LoyaltyPage` + validarea/avertismentele din
 * `lib/loyaltyForm.ts` (trepte ȘI invitații speciale).
 *
 * Textele cu parametri sunt funcții. Varianta română TREBUIE să rămână
 * identică cu cea de dinainte de traducere — testele afirmă exact aceste șiruri.
 */
import { defineMessages } from '../LanguageContext';

export const loyaltyMessages = defineMessages({
  ro: {
    page: {
      loading: 'Se încarcă treptele…',
      programTitle: 'Program de fidelitate',
      specialInvites: 'Invitații speciale',
      intro:
        'Treapta unui utilizator vine din numărul de EVENIMENTE DISTINCTE la care are ' +
        'check-in confirmat (ștampile Flirt Passport). Fiecare treaptă dă un procent de ' +
        'reducere la biletul online; la un bilet se aplică CEA MAI MARE reducere dintre ' +
        'treaptă, promo-ul evenimentului și invitație — nu se cumulează — iar rezultatul ' +
        'se taie la plafonul de mai jos.',
      lastChange: (when: string) => `Ultima modificare: ${when}`,
      capLabel: 'Plafon total de reducere (%)',
      tiersTitle: (count: number, max: number) => `Trepte (${count}/${max})`,
      addTier: 'Adaugă treaptă',
      empty: 'Nicio treaptă configurată — programul de fidelitate este oprit.',
      colCode: 'Cod',
      colName: 'Nume',
      colStamps: 'De la câte ștampile',
      colDiscount: 'Reducere (%)',
      colActions: 'Acțiuni',
      ariaCode: (position: number) => `Cod treapta ${position}`,
      ariaName: (position: number) => `Nume treapta ${position}`,
      ariaStamps: (position: number) => `Prag ștampile treapta ${position}`,
      ariaDiscount: (position: number) => `Reducere treapta ${position}`,
      ariaDelete: (position: number) => `Șterge treapta ${position}`,
      delete: 'Șterge',
      changesTitle: 'Ce se schimbă pentru utilizatori:',
      changesNote:
        'Câți utilizatori sunt exact în intervalele de mai sus nu se poate afișa: ' +
        'backendul nu expune distribuția ștampilelor pe utilizatori.',
      warningsTitle: 'Se poate salva, dar:',
      saved: (when: string) =>
        `Treptele au fost salvate (${when}). Se aplică imediat, fără deploy.`,
      discard: 'Renunță la modificări',
      saving: 'Se salvează…',
      save: 'Salvează treptele',
    },
    fieldNames: { code: 'Cod', name: 'Nume', note: 'Notă' },
    tiers: {
      fallbackLabel: (position: number) => `treapta ${position}`,
      codeRequired: 'Codul treptei este obligatoriu.',
      codeDuplicate: (code: string, first: number) =>
        `Codul „${code}" se repetă (treapta ${first}). Backendul ar păstra doar prima ` +
        'treaptă cu acest cod și ar șterge-o tăcut pe a doua.',
      nameRequired: 'Numele treptei este obligatoriu.',
      stampsRequired: 'Pragul este obligatoriu.',
      stampsInteger: 'Pragul se scrie ca număr întreg de ștampile.',
      stampsMin: 'Pragul minim este 1 ștampilă.',
      stampsMax: (max: number) => `Pragul maxim este ${max} de ștampile.`,
      stampsSame: (label: string, stamps: number) =>
        `Două trepte nu pot începe de la același prag: „${label}" începe tot ` +
        `de la ${stamps}.`,
      stampsOrder: (label: string, stamps: number) =>
        `Pragul trebuie să fie mai mare decât al treptei precedente („${label}" ` +
        `= ${stamps}). Backendul ar reordona scara în tăcere.`,
      percentRequired: 'Procentul este obligatoriu (poate fi 0).',
      percentInteger: 'Reducerea se exprimă în procente întregi.',
      percentRange: 'Reducerea trebuie să fie între 0 și 100%.',
      tooMany: (max: number) => `Maximum ${max} de trepte (plafonul schemei de pe backend).`,
      capRequired: 'Plafonul este obligatoriu (0 = nicio reducere).',
      capInteger: 'Plafonul se exprimă în procente întregi.',
      capRange: 'Plafonul trebuie să fie între 0 și 100%.',
    },
    tierWarnings: {
      empty:
        'Scara este GOALĂ: programul de fidelitate se oprește — niciun utilizator nu mai ' +
        'primește reducere de treaptă (promo-urile evenimentelor rămân neatinse).',
      zeroCap:
        'Plafonul de 0% anulează ORICE reducere la bilet, oricât ar da treptele sau promo-ul.',
      fallbackLabel: 'treaptă',
      overCap: (label: string, percent: number, cap: number) =>
        `Treapta „${label}" dă ${percent}%, peste plafonul de ${cap}% — la bilet se aplică ` +
        `tot ${cap}%.`,
      lessThanPrevious: (label: string, percent: number, bestLabel: string, best: number) =>
        `Treapta „${label}" (${percent}%) dă MAI PUȚIN decât „${bestLabel}" ` +
        `(${best}%), deși cere mai multe ștampile.`,
    },
    changes: {
      added: (label: string, stamps: number, percent: number) =>
        `Treaptă NOUĂ „${label}": de la ${stamps} ștampile, −${percent}%.`,
      thresholdUp: (label: string, from: number, to: number, range: string) =>
        `„${label}": pragul URCĂ de la ${from} la ${to} ștampile — ` +
        `utilizatorii cu ${range} ștampile PIERD treapta și reducerea ei.`,
      thresholdDown: (label: string, from: number, to: number, range: string) =>
        `„${label}": pragul COBOARĂ de la ${from} la ${to} ștampile — ` +
        `utilizatorii cu ${range} ștampile PRIMESC treapta de acum.`,
      discount: (label: string, from: number, to: number) =>
        `„${label}": reducerea trece de la ${from}% la ` +
        `${to}% pentru toți cei care au treapta.`,
      removed: (name: string, stamps: number, percent: number) =>
        `Treapta „${name}" DISPARE (era de la ${stamps} ștampile, ` +
        `−${percent}%): cine o avea rămâne fără reducerea ei.`,
      cap: (from: number, to: number) =>
        `Plafonul total trece de la ${from}% la ${to}%: orice ` +
        `reducere mai mare (treaptă, promo sau invitație) se taie la ${to}%.`,
    },
    invite: {
      eventRequired: 'Alege evenimentul pentru care se emite invitația.',
      usesRequired: 'Numărul de folosiri este obligatoriu.',
      usesInteger: 'Numărul de folosiri se scrie ca întreg.',
      usesMin: 'O invitație are cel puțin o folosire.',
      expiresRequired: 'Data de expirare este obligatorie.',
      dateInvalid: 'Data introdusă nu este validă.',
      expiresPast: 'Data de expirare trebuie să fie în viitor.',
      percentInteger: 'Reducerea se exprimă în procente întregi.',
      percentRange: 'Reducerea trebuie să fie între 0 și 100%.',
    },
    inviteWarnings: {
      usesCap: (cap: number) =>
        `Plafonul implicit al serverului e ${cap} de folosiri. ` +
        'Dacă nu a fost ridicat din configurare, serverul va respinge cererea.',
      tooFar: (days: number) =>
        `Expirarea depășește ${days} de zile — limita implicită a ` +
        'serverului. Dacă nu a fost ridicată din configurare, cererea va fi respinsă.',
      tooSoon:
        'Invitația expiră în mai puțin de 24 de ore — ajunge codul la invitat până atunci?',
      noPercent:
        'Fără procent, invitația NU schimbă prețul biletului: dă doar dreptul de acces ' +
        '(și trece de cerința de treaptă, dacă ai pus una).',
    },
    inviteStatus: {
      active: 'Activă',
      exhausted: 'Epuizată',
      expired: 'Expirată',
      revoked: 'Revocată',
    },
    usage: (used: number, max: number) => `${used} din ${max} folosite`,
  },
  ru: {
    page: {
      loading: 'Загрузка уровней…',
      programTitle: 'Программа лояльности',
      specialInvites: 'Специальные приглашения',
      intro:
        'Уровень пользователя определяется числом РАЗНЫХ СОБЫТИЙ, на которых у него ' +
        'подтверждён check-in (штампы Flirt Passport). Каждый уровень даёт процент ' +
        'скидки на онлайн-билет; к билету применяется САМАЯ БОЛЬШАЯ скидка из ' +
        'уровня, промо события и приглашения — они не суммируются, — а результат ' +
        'ограничивается лимитом ниже.',
      lastChange: (when: string) => `Последнее изменение: ${when}`,
      capLabel: 'Общий лимит скидки (%)',
      tiersTitle: (count: number, max: number) => `Уровни (${count}/${max})`,
      addTier: 'Добавить уровень',
      empty: 'Уровни не настроены — программа лояльности отключена.',
      colCode: 'Код',
      colName: 'Название',
      colStamps: 'От скольки штампов',
      colDiscount: 'Скидка (%)',
      colActions: 'Действия',
      ariaCode: (position: number) => `Код уровня ${position}`,
      ariaName: (position: number) => `Название уровня ${position}`,
      ariaStamps: (position: number) => `Порог штампов уровня ${position}`,
      ariaDiscount: (position: number) => `Скидка уровня ${position}`,
      ariaDelete: (position: number) => `Удалить уровень ${position}`,
      delete: 'Удалить',
      changesTitle: 'Что изменится для пользователей:',
      changesNote:
        'Точное число пользователей в указанных интервалах показать нельзя: ' +
        'бэкенд не отдаёт распределение штампов по пользователям.',
      warningsTitle: 'Можно сохранить, но:',
      saved: (when: string) =>
        `Уровни сохранены (${when}). Применяются сразу, без деплоя.`,
      discard: 'Отменить изменения',
      saving: 'Сохранение…',
      save: 'Сохранить уровни',
    },
    fieldNames: { code: 'Код', name: 'Название', note: 'Заметка' },
    tiers: {
      fallbackLabel: (position: number) => `уровень ${position}`,
      codeRequired: 'Код уровня обязателен.',
      codeDuplicate: (code: string, first: number) =>
        `Код «${code}» повторяется (уровень ${first}). Бэкенд оставит только первый ` +
        'уровень с этим кодом и молча удалит второй.',
      nameRequired: 'Название уровня обязательно.',
      stampsRequired: 'Порог обязателен.',
      stampsInteger: 'Порог указывается целым числом штампов.',
      stampsMin: 'Минимальный порог — 1 штамп.',
      stampsMax: (max: number) => `Максимальный порог — ${max} штампов.`,
      stampsSame: (label: string, stamps: number) =>
        `Два уровня не могут начинаться с одного порога: «${label}» тоже начинается ` +
        `с ${stamps}.`,
      stampsOrder: (label: string, stamps: number) =>
        `Порог должен быть больше, чем у предыдущего уровня («${label}» ` +
        `= ${stamps}). Иначе бэкенд молча переупорядочит шкалу.`,
      percentRequired: 'Процент обязателен (может быть 0).',
      percentInteger: 'Скидка указывается в целых процентах.',
      percentRange: 'Скидка должна быть от 0 до 100%.',
      tooMany: (max: number) => `Не более ${max} уровней (лимит схемы на бэкенде).`,
      capRequired: 'Лимит обязателен (0 = без скидки).',
      capInteger: 'Лимит указывается в целых процентах.',
      capRange: 'Лимит должен быть от 0 до 100%.',
    },
    tierWarnings: {
      empty:
        'Шкала ПУСТА: программа лояльности отключается — ни один пользователь больше ' +
        'не получает скидку по уровню (промо событий не затрагиваются).',
      zeroCap:
        'Лимит 0% отменяет ЛЮБУЮ скидку на билет, сколько бы ни давали уровни или промо.',
      fallbackLabel: 'уровень',
      overCap: (label: string, percent: number, cap: number) =>
        `Уровень «${label}» даёт ${percent}%, больше лимита ${cap}% — к билету применяется ` +
        `всё равно ${cap}%.`,
      lessThanPrevious: (label: string, percent: number, bestLabel: string, best: number) =>
        `Уровень «${label}» (${percent}%) даёт МЕНЬШЕ, чем «${bestLabel}» ` +
        `(${best}%), хотя требует больше штампов.`,
    },
    changes: {
      added: (label: string, stamps: number, percent: number) =>
        `НОВЫЙ уровень «${label}»: от ${stamps} штампов, −${percent}%.`,
      thresholdUp: (label: string, from: number, to: number, range: string) =>
        `«${label}»: порог ПОВЫШАЕТСЯ с ${from} до ${to} штампов — ` +
        `пользователи с ${range} штампами ТЕРЯЮТ уровень и его скидку.`,
      thresholdDown: (label: string, from: number, to: number, range: string) =>
        `«${label}»: порог ПОНИЖАЕТСЯ с ${from} до ${to} штампов — ` +
        `пользователи с ${range} штампами теперь ПОЛУЧАЮТ уровень.`,
      discount: (label: string, from: number, to: number) =>
        `«${label}»: скидка меняется с ${from}% на ` +
        `${to}% для всех, у кого есть этот уровень.`,
      removed: (name: string, stamps: number, percent: number) =>
        `Уровень «${name}» ИСЧЕЗАЕТ (был от ${stamps} штампов, ` +
        `−${percent}%): у кого он был, остаются без его скидки.`,
      cap: (from: number, to: number) =>
        `Общий лимит меняется с ${from}% на ${to}%: любая ` +
        `бо́льшая скидка (уровень, промо или приглашение) урезается до ${to}%.`,
    },
    invite: {
      eventRequired: 'Выберите событие, для которого выдаётся приглашение.',
      usesRequired: 'Число использований обязательно.',
      usesInteger: 'Число использований указывается целым числом.',
      usesMin: 'У приглашения минимум одно использование.',
      expiresRequired: 'Дата окончания обязательна.',
      dateInvalid: 'Введённая дата некорректна.',
      expiresPast: 'Дата окончания должна быть в будущем.',
      percentInteger: 'Скидка указывается в целых процентах.',
      percentRange: 'Скидка должна быть от 0 до 100%.',
    },
    inviteWarnings: {
      usesCap: (cap: number) =>
        `Лимит сервера по умолчанию — ${cap} использований. ` +
        'Если его не подняли в конфигурации, сервер отклонит запрос.',
      tooFar: (days: number) =>
        `Срок действия превышает ${days} дней — лимит сервера ` +
        'по умолчанию. Если его не подняли в конфигурации, запрос будет отклонён.',
      tooSoon:
        'Приглашение истекает менее чем через 24 часа — успеет ли код дойти до гостя?',
      noPercent:
        'Без процента приглашение НЕ меняет цену билета: оно даёт только право доступа ' +
        '(и снимает требование по уровню, если вы его задали).',
    },
    inviteStatus: {
      active: 'Активно',
      exhausted: 'Исчерпано',
      expired: 'Истекло',
      revoked: 'Отозвано',
    },
    usage: (used: number, max: number) => `использовано ${used} из ${max}`,
  },
});
