import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { tokenStore } from '@/api/tokenStore';

/**
 * jsdom nu implementează `PointerEvent`, iar deck-ul de swipe e construit exact
 * pe el. Fără polyfill, `fireEvent.pointerDown` ar produce un `Event` generic,
 * fără `clientX`, iar testele de gest ar fi lipsite de sens.
 */
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'touch';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent;
}

// Capturarea pointerului nu există în jsdom; deck-ul o cheamă defensiv (`?.`),
// dar o punem oricum, ca testele să exercite exact ramura din producție.
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  tokenStore.clear();
  delete window.Telegram;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
