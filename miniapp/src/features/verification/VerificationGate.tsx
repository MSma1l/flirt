/**
 * POARTA verificării prin selfie: ecranul se deschide DOAR dacă serverul spune
 * că funcția e reală.
 *
 * De ce o poartă separată, și nu o condiție înăuntrul lui `VerificationScreen`:
 * cât timp funcția e oprită, ecranul nu trebuie nici măcar MONTAT. Montat, ar
 * porni cererea de profil, ar pregăti camera, ar arăta butoane — adică exact
 * fluxul pe care îl ascundem. Așa, `VerificationScreen` rămâne neatins și nu
 * face nicio cerere; când funcția e disponibilă, totul e exact ca azi.
 *
 * Ruta rămâne ÎNREGISTRATĂ, intenționat. Cine ajunge pe `/verificare` dintr-un
 * link vechi sau dintr-un buton înapoi merită un mesaj scurt și corect plus un
 * drum spre profil — nu „pagina nu există", nu o redirecționare tăcută care l-ar
 * face să creadă că aplicația s-a stricat.
 *
 * BADGE-UL EXISTENT NU E ATINS: starea `Profile.verified` e a serverului, iar
 * poarta asta nu scrie nimic. Un cont verificat înainte de oprire rămâne
 * verificat — oprirea privește câștigarea insignei de acum înainte, nu
 * retragerea celor deja acordate.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatusScreen } from '@/components/StatusScreen';
import { CAPABILITY, useCapability } from '@/features/capabilities';
import { PROFILE_PATH } from '@/features/onboarding/paths';

import { VerificationScreen } from './VerificationScreen';

import './verification.css';

export function VerificationGate() {
  const { t } = useTranslation(['screens', 'verification', 'profile']);
  const { enabled, isLoading } = useCapability(CAPABILITY.faceVerification);

  // Cât timp nu știm, nu arătăm nici fluxul, nici refuzul: a arăta fluxul și
  // a-l retrage după o clipă ar fi mai rău decât o rotiță scurtă.
  if (isLoading) {
    return (
      <StatusScreen
        loading
        logo={false}
        testId="status-verify-gate"
        title={t('profile:edit.loading')}
      />
    );
  }

  if (!enabled) {
    return (
      <div className="verify-screen" data-testid="verify-unavailable">
        <h1 className="title">{t('screens:verification.unavailableTitle')}</h1>
        <p className="body-text">{t('screens:verification.unavailableBody')}</p>
        <Link className="button button--ghost" to={PROFILE_PATH} data-testid="verify-back">
          {t('screens:verification.backToProfile')}
        </Link>
      </div>
    );
  }

  return <VerificationScreen />;
}

export default VerificationGate;
