/**
 * Linkurile legale de pe ecranul de bun venit.
 *
 * DE CE ecranul ĂSTA: e ultimul pas înainte ca omul să-și pună datele personale
 * în aplicație. Termenii și politica de confidențialitate trebuie să fie
 * accesibile ÎNAINTE de asta, nu ascunse într-un meniu. Paginile sunt servite de
 * backend (`backend/app/api/legal.py`, la rădăcină, fără autentificare), iar
 * adresele se derivă din adresa API — nimic hardcodat în ecran.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getLegalUrls } from '@/config';

import { WelcomeScreen } from '../WelcomeScreen';
import { renderRouted } from './testUtils';

describe('ecranul de bun venit arată termenii și confidențialitatea', () => {
  it('are ambele legături, către paginile publice ale backendului', () => {
    renderRouted(<WelcomeScreen />);
    const legal = getLegalUrls();

    const terms = screen.getByTestId('legal-terms');
    const privacy = screen.getByTestId('legal-privacy');
    expect(terms).toHaveAttribute('href', legal.termsUrl ?? '');
    expect(privacy).toHaveAttribute('href', legal.privacyUrl ?? '');
    // Pagina se deschide în afara Mini App-ului: fără `opener`, fără referrer.
    expect(terms).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // Textele sunt traduse, nu chei crude scăpate în pagină.
    expect(terms).toHaveTextContent('Termeni');
    expect(privacy).toHaveTextContent('Confidențialitate');
    expect(screen.getByText(/Continuând, accepți/)).toBeInTheDocument();
  });

  it('adresele arată exact spre rutele backendului', () => {
    const legal = getLegalUrls();
    expect(legal.termsUrl).toMatch(/\/legal\/terms$/);
    expect(legal.privacyUrl).toMatch(/\/legal\/privacy$/);
    expect(legal.supportUrl).toMatch(/\/legal\/support$/);
  });
});
