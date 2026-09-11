/**
 * Regulile de navigare, pure: ce rută cere fiecare stare și când chiar e nevoie
 * să mutăm userul. Capătul viu (store-uri, `router.replace`) se testează în
 * `app/__tests__/authGuard.test.tsx`.
 */
import { navigationTarget, resolveAppRoute, type AppRouteInput } from '../appRoute';

/** Un user complet, cu toate porțile deschise — punctul de plecare al testelor. */
const READY: AppRouteInput = {
  status: 'authenticated',
  profileCompleted: true,
  needsQuiz: false,
  humorPending: false,
  needsPhotos: false,
};

describe('resolveAppRoute', () => {
  it('sesiunea se hidratează → nicio pretenție (userul rămâne pe splash)', () => {
    expect(resolveAppRoute({ ...READY, status: 'loading' })).toBeNull();
  });

  it('neautentificat → welcome', () => {
    expect(resolveAppRoute({ ...READY, status: 'unauthenticated' })).toBe(
      '/(auth)/welcome',
    );
  });

  it('anketă neterminată → onboarding', () => {
    expect(resolveAppRoute({ ...READY, profileCompleted: false })).toBe('/(onboarding)');
  });

  it('fără date de umor → quiz, nu feed', () => {
    expect(resolveAppRoute({ ...READY, needsQuiz: true })).toBe('/humor');
  });

  it('totul complet → feed', () => {
    expect(resolveAppRoute(READY)).toBe('/(tabs)/ankete');
  });

  it('poarta de umor încă nu știe → NU decidem („nu știu" ≠ „n-are nevoie")', () => {
    // Altfel userul e trimis în feed și scos înapoi la quiz o clipă mai târziu.
    expect(resolveAppRoute({ ...READY, humorPending: true })).toBeNull();
  });

  it('un verdict de umor bate așteptarea (nu rămânem blocați pe splash)', () => {
    expect(resolveAppRoute({ ...READY, humorPending: false, needsQuiz: true })).toBe(
      '/humor',
    );
  });

  it('profil incomplet + serverul a precizat „pozele" → editorul, nu wizardul', () => {
    // `profile_completed` de pe server e ȘI-ul dintre anketă și poze, deci
    // `false` singur nu spune care lipsește. Wizardul ar reporni de la pasul 0
    // cu un draft gol și ar rescrie la final un profil perfect bun.
    expect(
      resolveAppRoute({ ...READY, profileCompleted: false, needsPhotos: true }),
    ).toBe('/profile/edit');
  });

  it('precizarea nu ține pe nimeni blocat: cu profilul complet nu mai schimbă nimic', () => {
    // Când userul adaugă pozele, flagul de pe server se aprinde și precizarea
    // rămâne fără obiect — de asta nu trebuie stinsă de nimeni.
    expect(resolveAppRoute({ ...READY, needsPhotos: true })).toBe('/(tabs)/ankete');
  });

  it('ordinea porților o repetă pe cea a serverului: profil → umor', () => {
    // Serverul reclamă mereu prima problemă din lanț, deci acolo trimitem și noi.
    const broken = { ...READY, profileCompleted: false, needsQuiz: true };
    expect(resolveAppRoute(broken)).toBe('/(onboarding)');
    expect(resolveAppRoute({ ...broken, needsPhotos: true })).toBe('/profile/edit');
    expect(resolveAppRoute({ ...broken, profileCompleted: true })).toBe('/humor');
  });
});

describe('navigationTarget', () => {
  it('fără pretenție → nu se navighează', () => {
    expect(navigationTarget(null, ['(tabs)'])).toBeNull();
  });

  it('userul e deja pe ecranul cerut → nu se navighează (fără buclă)', () => {
    expect(navigationTarget('/humor', ['humor'])).toBeNull();
    expect(navigationTarget('/(onboarding)', ['(onboarding)'])).toBeNull();
    expect(navigationTarget('/profile/edit', ['profile', 'edit'])).toBeNull();
  });

  it('userul e în altă parte decât ecranul cerut → navighează', () => {
    expect(navigationTarget('/humor', ['(tabs)', 'ankete'])).toBe('/humor');
    expect(navigationTarget('/(auth)/welcome', ['(tabs)'])).toBe('/(auth)/welcome');
  });

  it('pe splash (fără segmente) navighează mereu: acolo nu se poate rămâne', () => {
    expect(navigationTarget('/(tabs)/ankete', [])).toBe('/(tabs)/ankete');
    expect(navigationTarget('/humor', [])).toBe('/humor');
    expect(navigationTarget('/(auth)/welcome', [])).toBe('/(auth)/welcome');
  });

  it('poarta s-a deschis → userul e scos din ecranul-poartă în aplicație', () => {
    expect(navigationTarget('/(tabs)/ankete', ['(auth)', 'login'])).toBe('/(tabs)/ankete');
    expect(navigationTarget('/(tabs)/ankete', ['(onboarding)'])).toBe('/(tabs)/ankete');
  });

  it('dar quiz-ul deschis de bunăvoie (Setări → Testul de umor) nu e închis peste user', () => {
    // Ecranul de quiz iese singur când userul termină; dacă l-am trata ca pe un
    // ecran-poartă, cine vrea să-și redea testul ar fi aruncat imediat în feed.
    expect(navigationTarget('/(tabs)/ankete', ['humor'])).toBeNull();
  });

  it('dar NU e smuls dintr-un ecran obișnuit doar fiindcă poarta e deschisă', () => {
    // Cine citește un chat sau se uită la un eveniment rămâne acolo.
    expect(navigationTarget('/(tabs)/ankete', ['chat', '[id]'])).toBeNull();
    expect(navigationTarget('/(tabs)/ankete', ['events', 'index'])).toBeNull();
    expect(navigationTarget('/(tabs)/ankete', ['profile', 'edit'])).toBeNull();
    expect(navigationTarget('/(tabs)/ankete', ['(tabs)', 'setari'])).toBeNull();
  });

  it('navigarea în interiorul unui ecran-poartă e liberă (login ↔ register)', () => {
    expect(navigationTarget('/(auth)/welcome', ['(auth)', 'register'])).toBeNull();
  });
});
