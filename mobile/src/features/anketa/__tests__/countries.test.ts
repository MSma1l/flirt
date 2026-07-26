import { COUNTRIES, findCountry, searchCountries } from '../countries';

describe('countries — findCountry', () => {
  it('rezolvă un cod ISO2 (indiferent de majuscule)', () => {
    expect(findCountry('MD')?.name).toBe('Republica Moldova');
    expect(findCountry('md')?.name).toBe('Republica Moldova');
    expect(findCountry('  ro  ')?.code).toBe('RO');
  });

  it('rezolvă valorile vechi scrise ca nume RO sau EN (text liber)', () => {
    expect(findCountry('România')?.code).toBe('RO');
    expect(findCountry('Moldova')?.code).toBe('MD'); // nameEn
    expect(findCountry('romania')?.code).toBe('RO'); // case-insensitive
  });

  it('întoarce undefined pentru valori goale sau necunoscute', () => {
    expect(findCountry(undefined)).toBeUndefined();
    expect(findCountry(null)).toBeUndefined();
    expect(findCountry('')).toBeUndefined();
    expect(findCountry('   ')).toBeUndefined();
    expect(findCountry('Narnia')).toBeUndefined();
  });
});

describe('countries — searchCountries', () => {
  it('întoarce TOATE țările pentru un query gol', () => {
    expect(searchCountries('')).toBe(COUNTRIES);
    expect(searchCountries('   ')).toBe(COUNTRIES);
  });

  it('filtrează după numele românesc (parțial, case-insensitive)', () => {
    const results = searchCountries('român');
    expect(results.some((c) => c.code === 'RO')).toBe(true);
    // Un termen restrâns nu aduce toată lista.
    expect(results.length).toBeLessThan(COUNTRIES.length);
  });

  it('filtrează și după numele englezesc (alias)', () => {
    const results = searchCountries('germany');
    expect(results.map((c) => c.code)).toContain('DE');
  });

  it('găsește după cod ISO2 exact', () => {
    const results = searchCountries('md');
    expect(results.some((c) => c.code === 'MD')).toBe(true);
  });

  it('întoarce listă goală pentru un termen fără potrivire', () => {
    expect(searchCountries('zzzznope')).toHaveLength(0);
  });
});
