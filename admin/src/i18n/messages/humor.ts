/** Testul de umor: comutatorul global, textul de introducere și glumele. */
import { defineMessages } from '../LanguageContext';

export const humorMessages = defineMessages({
  ro: {
    loading: 'Se încarcă testul de umor…',
    statusTitle: 'Starea testului',
    statusOn: 'ACTIV',
    statusOff: 'INACTIV',
    toggleLabel: 'Test de umor activ',
    onExplain:
      'Utilizatorii fără test nu pot da like până nu îl fac, iar umorul contează la scorul ' +
      'de chimie. În Mini App testul apare în meniu, cu ecranul de introducere.',
    offExplain:
      'Nimeni nu e obligat să dea testul, feed-ul și like-urile merg normal, iar umorul nu ' +
      'mai influențează scorul de chimie. În Mini App intrarea spre test e ascunsă.',
    activeCount: (active: number, min: number) =>
      `Glume active: ${active} (minimum ${min} ca testul să poată fi pornit)`,
    belowMin: (min: number) =>
      `Activează cel puțin ${min} glume ca să poți porni testul.`,
    toggling: 'Se salvează…',
    lastChange: (when: string) => `Ultima modificare: ${when}`,

    introTitle: 'Ecranul de introducere',
    introHint:
      'Apare înainte de prima glumă: de ce facem testul, cât durează, cine vede ' +
      'răspunsurile. Un paragraf nou = un rând gol. Gol = textul implicit al aplicației.',
    introLabel: (lang: string) => `Text ${lang}`,
    introSave: 'Salvează textul',
    introSaving: 'Se salvează…',
    introSaved: 'Textul a fost salvat. Se vede imediat în aplicație.',
    discard: 'Renunță',

    questionsTitle: (active: number, total: number) => `Glume (${active} active din ${total})`,
    addQuestion: 'Adaugă glumă',
    emptyTitle: 'Nicio glumă',
    emptyHint: 'Adaugă glume ca să poți porni testul.',
    active: 'activă',
    inactive: 'inactivă',
    moveUp: 'Mută mai sus',
    moveDown: 'Mută mai jos',
    edit: 'Editează',
    activate: 'Activează',
    deactivate: 'Dezactivează',
    delete: 'Șterge',
    position: (n: number) => `#${n}`,
    deleteTitle: 'Ștergi gluma?',
    deleteMessage:
      'Gluma dispare definitiv din test. Profilurile de umor deja salvate nu sunt afectate ' +
      '(se păstrează pe tipuri de umor, nu pe glume). Dacă vrei doar s-o ascunzi, folosește ' +
      '„Dezactivează".',
    deleteConfirm: 'Șterge gluma',

    newTitle: 'Glumă nouă',
    editTitle: 'Editează gluma',
    typeLabel: 'Tipul de umor măsurat',
    typeHint:
      'Răspunsul „amuzant" crește ponderea acestui tip în profilul de umor al utilizatorului.',
    textLabel: (lang: string) => `Textul glumei ${lang}`,
    textRequired: 'Textul este obligatoriu în toate cele 3 limbi.',
    activeLabel: 'Activă (apare în test)',
    cancel: 'Anulează',
    save: 'Salvează',
    saving: 'Se salvează…',
    counter: (n: number, max: number) => `${n}/${max}`,
    types: {
      sarcasm: 'Sarcasm',
      dark: 'Umor negru',
      memes: 'Meme',
      intellectual: 'Intelectual',
      absurd: 'Absurd',
      wholesome: 'Drăguț / cald',
      physical: 'Slapstick (fizic)',
    } as Record<string, string>,
  },
  ru: {
    loading: 'Загрузка теста на юмор…',
    statusTitle: 'Состояние теста',
    statusOn: 'ВКЛЮЧЁН',
    statusOff: 'ВЫКЛЮЧЕН',
    toggleLabel: 'Тест на юмор включён',
    onExplain:
      'Пользователи без теста не могут ставить лайки, пока не пройдут его, а юмор ' +
      'учитывается в оценке «химии». В Mini App тест есть в меню, с вводным экраном.',
    offExplain:
      'Никто не обязан проходить тест, лента и лайки работают как обычно, а юмор не ' +
      'влияет на оценку «химии». В Mini App вход в тест скрыт.',
    activeCount: (active: number, min: number) =>
      `Активных шуток: ${active} (минимум ${min}, чтобы включить тест)`,
    belowMin: (min: number) => `Включите хотя бы ${min} шутки, чтобы можно было включить тест.`,
    toggling: 'Сохранение…',
    lastChange: (when: string) => `Последнее изменение: ${when}`,

    introTitle: 'Вводный экран',
    introHint:
      'Показывается перед первой шуткой: зачем тест, сколько длится, кто видит ответы. ' +
      'Новый абзац — пустая строка. Пусто — стандартный текст приложения.',
    introLabel: (lang: string) => `Текст ${lang}`,
    introSave: 'Сохранить текст',
    introSaving: 'Сохранение…',
    introSaved: 'Текст сохранён. Он сразу виден в приложении.',
    discard: 'Отменить',

    questionsTitle: (active: number, total: number) => `Шутки (${active} активных из ${total})`,
    addQuestion: 'Добавить шутку',
    emptyTitle: 'Нет шуток',
    emptyHint: 'Добавьте шутки, чтобы можно было включить тест.',
    active: 'активна',
    inactive: 'неактивна',
    moveUp: 'Переместить выше',
    moveDown: 'Переместить ниже',
    edit: 'Изменить',
    activate: 'Включить',
    deactivate: 'Выключить',
    delete: 'Удалить',
    position: (n: number) => `#${n}`,
    deleteTitle: 'Удалить шутку?',
    deleteMessage:
      'Шутка навсегда исчезнет из теста. Уже сохранённые профили юмора не затрагиваются ' +
      '(они хранятся по типам юмора, а не по шуткам). Чтобы просто скрыть её, используйте ' +
      '«Выключить».',
    deleteConfirm: 'Удалить шутку',

    newTitle: 'Новая шутка',
    editTitle: 'Изменить шутку',
    typeLabel: 'Измеряемый тип юмора',
    typeHint: 'Ответ «смешно» увеличивает вес этого типа в профиле юмора пользователя.',
    textLabel: (lang: string) => `Текст шутки ${lang}`,
    textRequired: 'Текст обязателен на всех 3 языках.',
    activeLabel: 'Активна (показывается в тесте)',
    cancel: 'Отмена',
    save: 'Сохранить',
    saving: 'Сохранение…',
    counter: (n: number, max: number) => `${n}/${max}`,
    types: {
      sarcasm: 'Сарказм',
      dark: 'Чёрный юмор',
      memes: 'Мемы',
      intellectual: 'Интеллектуальный',
      absurd: 'Абсурд',
      wholesome: 'Добрый',
      physical: 'Слэпстик (физический)',
    } as Record<string, string>,
  },
});
