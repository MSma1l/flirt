import { cardText } from '../cardText';
import { HumorCard } from '../types';

/** Card complet, așa cum îl trimite serverul (toate cele 4 limbi). */
const full: HumorCard = {
  id: 'c1',
  type: 'sarcasm',
  text_ro: 'Glumă în română',
  text_ru: 'Шутка по-русски',
  text_uk: 'Жарт українською',
  text_en: 'A joke in English',
};

describe('cardText', () => {
  it('alege textul limbii active pentru fiecare dintre cele 4 limbi', () => {
    expect(cardText(full, 'ro')).toBe('Glumă în română');
    expect(cardText(full, 'ru')).toBe('Шутка по-русски');
    expect(cardText(full, 'uk')).toBe('Жарт українською');
    expect(cardText(full, 'en')).toBe('A joke in English');
  });

  it('lipsește textul într-o limbă → cade pe română, nu rămâne gol', () => {
    const missing: HumorCard = { ...full, text_uk: undefined };
    expect(cardText(missing, 'uk')).toBe('Glumă în română');
  });

  it('text gol sau doar spații se tratează ca lipsă (fallback pe română)', () => {
    expect(cardText({ ...full, text_ru: '' }, 'ru')).toBe('Glumă în română');
    expect(cardText({ ...full, text_ru: '   ' }, 'ru')).toBe('Glumă în română');
  });

  it('server vechi (doar `text`, fără variante localizate) → folosește aliasul', () => {
    const legacy: HumorCard = { id: 'c1', type: 'sarcasm', text: 'Glumă veche' };
    expect(cardText(legacy, 'en')).toBe('Glumă veche');
  });

  it('card fără niciun text → string gol, nu aruncă', () => {
    expect(cardText({ id: 'c1', type: 'sarcasm' }, 'ro')).toBe('');
  });
});
