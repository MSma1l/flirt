/**
 * Folosirea unui cod de invitație primit de la organizator.
 *
 * TREI DECIZII CARE SE VĂD:
 *
 * 1. CODUL SE NORMALIZEAZĂ ÎN CÂMP, la fiecare tastă (`normalizeInviteCode`).
 *    Utilizatorul nu e pedepsit pentru un spațiu sau o literă mică, iar ce vede
 *    în câmp e EXACT ce pleacă spre server. Un câmp gol nu se trimite deloc:
 *    ar fi o cerere sigur respinsă, contorizată de limitatorul de rată al rutei.
 *
 * 2. FIECARE EȘEC AL BACKENDULUI ARE TEXTUL LUI (vezi `loyaltyErrors.ts`):
 *    cod inexistent, expirat, epuizat, revocat, treaptă insuficientă, prea multe
 *    încercări, fără rețea. „Ceva n-a mers" nu spune omului dacă să mai încerce,
 *    să scrie organizatorului sau să mai meargă la un eveniment.
 *
 * 3. „AI FOLOSIT-O DEJA" NU E O EROARE. Ruta e idempotentă: același user cu
 *    același cod primește 200 și `consumed_new_use: false`. Îi arătăm o
 *    confirmare liniștită, nu felicitări (n-a mai primit nimic) și nici o
 *    eroare roșie (nu a greșit cu nimic).
 *
 * Zero `alert()` / `confirm()`: blochează WebView-ul Telegram.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INVITE_CODE_MAX_LENGTH, normalizeInviteCode } from './inviteCode';
import { redeemInvite, type InviteRedemption } from './loyaltyApi';
import { redeemErrorKey, toRedeemError, type RedeemError } from './loyaltyErrors';
import { useRefreshLoyalty } from './useLoyalty';

import './loyalty.css';

export function InviteRedeemForm() {
  const { t } = useTranslation('screens');
  const refreshLoyalty = useRefreshLoyalty();

  const [code, setCode] = useState('');
  const [result, setResult] = useState<InviteRedemption | null>(null);
  const [failure, setFailure] = useState<RedeemError | null>(null);

  const redeem = useMutation<InviteRedemption, unknown, string>({
    mutationFn: (value) => redeemInvite(value),
    onSuccess: (redemption) => {
      setResult(redemption);
      setFailure(null);
      setCode('');
      // Prețul altor evenimente tocmai s-a schimbat: invalidăm cotațiile.
      refreshLoyalty();
    },
    onError: (error) => {
      setResult(null);
      setFailure(toRedeemError(error));
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeInviteCode(code);
    if (normalized === '' || redeem.isPending) return;
    // Câmpul arată deja forma canonică, dar o normalizăm încă o dată: valoarea
    // poate veni dintr-un `paste` urmat imediat de Enter.
    setCode(normalized);
    redeem.mutate(normalized);
  };

  const normalized = normalizeInviteCode(code);

  let message: React.ReactNode = null;
  if (failure) {
    // Pragul cerut de invitație vine DOAR ca text în `detail`. Când l-am putut
    // citi, mesajul îl spune (cu pluralul limbii); când nu, folosim varianta
    // fără cifră — mai bine vag decât un „0 ștampile" inventat.
    const known = failure.requiredStamps !== null;
    const key =
      failure.kind === 'tier_too_low' && !known
        ? 'loyalty.invite.errors.tierUnknownThreshold'
        : redeemErrorKey(failure.kind);
    message = (
      <p className="error-text ly-invite__msg" role="alert" data-testid="invite-error">
        {known ? t(key, { count: failure.requiredStamps as number }) : t(key)}
      </p>
    );
  } else if (result) {
    // Trei mesaje, nu unul: invitație nouă cu reducere, invitație nouă fără
    // reducere (organizatorul a emis doar accesul), invitație pe care o aveai.
    const key = !result.consumedNewUse
      ? 'loyalty.invite.already'
      : result.discountPercent > 0
        ? 'loyalty.invite.success'
        : 'loyalty.invite.successNoDiscount';
    message = (
      <p className="ly-invite__msg ly-invite__msg--ok" role="status" data-testid="invite-success">
        {t(key, { event: result.eventTitle, percent: result.discountPercent })}
      </p>
    );
  }

  return (
    <form className="ly-invite" onSubmit={submit} data-testid="invite-form">
      <label className="ly-invite__label" htmlFor="invite-code">
        {t('loyalty.invite.label')}
      </label>
      <p className="caption ly-invite__hint">{t('loyalty.invite.hint')}</p>
      <div className="ly-invite__row">
        <input
          id="invite-code"
          className="input ly-invite__input"
          type="text"
          value={code}
          maxLength={INVITE_CODE_MAX_LENGTH}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('loyalty.invite.placeholder')}
          aria-label={t('loyalty.invite.label')}
          data-testid="invite-input"
          onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
        />
        <button
          type="submit"
          className="button ly-invite__submit"
          disabled={normalized === '' || redeem.isPending}
          data-testid="invite-submit"
        >
          {redeem.isPending ? t('loyalty.invite.sending') : t('loyalty.invite.submit')}
        </button>
      </div>
      {message}
    </form>
  );
}

export default InviteRedeemForm;
