/**
 * Tipuri pentru `qrcode-generator`, importat pe calea ESM EXPLICITĂ.
 *
 * DE CE nu importăm pachetul pe numele lui scurt: `qrcode-generator@1.5.1` are
 * două builduri incompatibile ca formă. `main` (CommonJS) exportă funcția prin
 * `module.exports`, iar `module` (`dist/qrcode.mjs`, cel pe care îl alege Vite
 * în browser) o exportă NUMIT: `export const qrcode = …`, fără export implicit.
 * Declarația de tipuri livrată de pachet descrie doar varianta CommonJS
 * (`export = qrcode`), deci un `import qrcode from 'qrcode-generator'` trece de
 * TypeScript, dar ajunge `undefined` în bundle-ul de browser — exact genul de
 * eroare care nu apare în teste (unde se rezolvă varianta CJS) și cade în
 * producție.
 *
 * Ca să avem UN SINGUR comportament peste tot, importăm direct `dist/qrcode.mjs`
 * și îi descriem aici doar partea din API pe care o folosim. Pachetul nu are
 * câmp `exports`, deci calea adâncă e legitimă.
 */
declare module 'qrcode-generator/dist/qrcode.mjs' {
  /** Nivelul de corecție a erorilor, în ordinea crescătoare a redundanței. */
  export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  /** Matricea de module, după `make()`. */
  export interface QrCodeModel {
    addData(data: string): void;
    make(): void;
    /** Latura matricei, în module (fără zona liniștită). */
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }

  /** `typeNumber` 0 = versiune aleasă automat, cât de mică încape. */
  export function qrcode(
    typeNumber: number,
    errorCorrectionLevel: QrErrorCorrectionLevel,
  ): QrCodeModel;
}
