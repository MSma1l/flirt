/**
 * Codul QR: un simbol real, citibil și de scaner, și de cititorul de ecran.
 *
 * Testele NU verifică biți din matrice (ar fi un test al bibliotecii, nu al
 * componentei), ci contractul pe care se bazează ecranul: iese un SVG cu module,
 * codul ajunge în `aria-label` și în text, iar o valoare goală nu dărâmă ecranul.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QrCode, formatTicketCode } from '../QrCode';

describe('QrCode', () => {
  it('randează un SVG cu module', () => {
    render(<QrCode value="FLIRT-ABC123" />);

    const svg = screen.getByRole('img');
    expect(svg.tagName.toLowerCase()).toBe('svg');

    // Calea modulelor există și e nevidă: fiecare „M…h1v1h-1z" e un modul negru.
    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d') ?? '').toContain('h1v1h-1z');

    // `viewBox` include zona liniștită de 4 module pe fiecare latură.
    const viewBox = svg.getAttribute('viewBox') ?? '';
    const side = Number(viewBox.split(' ')[3]);
    expect(side).toBeGreaterThanOrEqual(21 + 8);
  });

  it('are aria-label cu codul, ca să nu fie o imagine mută', () => {
    render(<QrCode value="FLIRT-ABC123" label="Cod bilet" />);

    expect(screen.getByRole('img')).toHaveAccessibleName('Cod bilet: FLIRT-ABC123');
  });

  it('arată codul și ca text, pentru citire manuală la intrare', () => {
    render(<QrCode value="ABCD1234" />);

    expect(screen.getByTestId('ticket-qr')).toHaveTextContent('ABCD 1234');
  });

  it('un cod gol nu aruncă — rămâne doar fără simbol', () => {
    expect(() => render(<QrCode value="" />)).not.toThrow();
    expect(screen.getByTestId('ticket-qr')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('grupează codul în blocuri de 4', () => {
    expect(formatTicketCode('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    expect(formatTicketCode('')).toBe('');
  });
});
