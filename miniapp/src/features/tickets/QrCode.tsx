/**
 * Cod QR randat ca SVG inline.
 *
 * PORT al lui `react-native-qrcode-svg` din aplicația Expo. Acela e o
 * componentă nativă și nu are ce căuta în browser, deci folosim
 * `qrcode-generator` (MIT, zero dependențe, ~51 KB sursă ESM) și desenăm noi
 * matricea.
 *
 * DE CE construim elementele în JSX și nu folosim `createSvgTag()` al
 * bibliotecii: acela întoarce un șir de markup, care ar trebui băgat în pagină
 * cu `dangerouslySetInnerHTML`. Codul biletului vine de la server; chiar dacă
 * azi e alfanumeric, nu vrem o cale prin care un șir să ajungă HTML. Un `<path>`
 * construit din `isDark()` nu are cum să injecteze nimic.
 */
import { useMemo } from 'react';

import { qrcode } from 'qrcode-generator/dist/qrcode.mjs';

import './tickets.css';

/**
 * Zona liniștită impusă de standardul QR: 4 module de margine albă, altfel
 * scanerele nu găsesc capetele simbolului.
 */
const QUIET_ZONE = 4;

export interface QrCodeProps {
  /** Conținutul codificat — codul biletului. */
  value: string;
  /** Latura desenului, în pixeli CSS. */
  size?: number;
  /** Eticheta de deasupra codului în clar (ex. „Cod bilet"). */
  label?: string;
  testId?: string;
}

/**
 * Rupe codul în grupuri de 4, separate prin spații (regula din
 * `mobile/app/ticket.tsx`): se încadrează pe lățimea cardului și primește
 * puncte de rupere, în loc să iasă din ecran ca un singur cuvânt lung.
 */
export function formatTicketCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join(' ');
}

/** Matricea desenată: latura totală (cu zona liniștită) + calea modulelor. */
interface QrDrawing {
  side: number;
  path: string;
}

/**
 * Construiește calea SVG a modulelor întunecate.
 *
 * Întoarce `null` în loc să arunce dacă valoarea e goală sau prea lungă pentru
 * orice versiune de QR: componenta rămâne montată și afișează codul în clar,
 * care oricum e planul de rezervă la intrare. Un ecran de bilet nu are voie să
 * cadă cu tot cu aplicația din cauza unui șir ciudat.
 */
function buildDrawing(value: string): QrDrawing | null {
  if (!value) return null;
  try {
    // Nivelul „M" e compromisul folosit și pe mobil: ~15% redundanță, simbol mic.
    const model = qrcode(0, 'M');
    model.addData(value);
    model.make();

    const count = model.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (model.isDark(row, col)) {
          // Un dreptunghi de 1×1 module; coordonatele sunt în unități de modul,
          // scalarea o face `viewBox`.
          parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
        }
      }
    }
    return { side: count + QUIET_ZONE * 2, path: parts.join('') };
  } catch {
    return null;
  }
}

export function QrCode({ value, size = 168, label, testId = 'ticket-qr' }: QrCodeProps) {
  const drawing = useMemo(() => buildDrawing(value), [value]);

  return (
    <div className="tk-qr" data-testid={testId}>
      {/*
       * SINGURA excepție din tot modulul de la regula „doar variabile CSS":
       * fundalul alb și modulele negre sunt scrise direct. Un cod QR trebuie să
       * aibă contrast maxim ca să fie scanabil, indiferent dacă utilizatorul
       * ține Telegram pe temă închisă sau deschisă. Dacă modulele ar lua
       * `--color-text-primary`, pe tema închisă ar ieși un simbol alb pe alb.
       */}
      <div className="tk-qr__frame" style={{ width: size, height: size }}>
        {drawing ? (
          <svg
            className="tk-qr__svg"
            viewBox={`0 0 ${drawing.side} ${drawing.side}`}
            role="img"
            aria-label={label ? `${label}: ${value}` : value}
            // Modulele sunt dreptunghiuri aliniate la grilă: fără antialiasing
            // marginile rămân tăioase și scanarea de pe ecran e mai sigură.
            shapeRendering="crispEdges"
          >
            <rect x="0" y="0" width={drawing.side} height={drawing.side} fill="#ffffff" />
            <path d={drawing.path} fill="#000000" />
          </svg>
        ) : null}
      </div>

      {/* Codul în clar: dacă scanarea eșuează (ecran murdar, lumină proastă),
          omul de la intrare îl poate citi și tasta. Selectabil, spre deosebire
          de restul Mini App-ului, unde selecția e oprită pentru gesturi. */}
      <div className="tk-qr__code-box">
        {label ? <span className="caption">{label}</span> : null}
        <span className="tk-qr__code">{formatTicketCode(value)}</span>
      </div>
    </div>
  );
}

export default QrCode;
