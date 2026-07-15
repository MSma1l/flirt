import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Alert, AlertButton, Platform } from 'react-native';

import { PhotoGrid } from '../PhotoGrid';
import { moveItem } from '../reorder';
import { PhotoTile } from '../types';
import { PHOTO_LIMITS } from '../validation';
import { ThemeProvider } from '@theme/index';

function tiles(...uris: string[]): PhotoTile[] {
  return uris.map((uri) => ({ key: uri, uri }));
}

interface Handlers {
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  onOpenSettings?: () => void;
}

function renderGrid(
  photos: PhotoTile[],
  handlers: Handlers = {},
  extra: { error?: string | null; permissionDenied?: boolean } = {},
) {
  return render(
    <ThemeProvider>
      <PhotoGrid
        photos={photos}
        onAdd={handlers.onAdd ?? jest.fn()}
        onRemove={handlers.onRemove ?? jest.fn()}
        onMove={handlers.onMove ?? jest.fn()}
        onOpenSettings={handlers.onOpenSettings ?? jest.fn()}
        error={extra.error}
        permissionDenied={extra.permissionDenied}
      />
    </ThemeProvider>,
  );
}

/**
 * Rulează `body` ca și cum am fi pe web: `Platform.OS === 'web'` + un `window.confirm`
 * fals (mediul de test RN nu are unul). Restaurează AMBELE în `finally`, ca să nu
 * scape starea „web" în testele următoare, chiar dacă o aserțiune eșuează.
 */
function withWebPlatform(confirmMock: () => boolean, body: () => void) {
  const originalOS = Platform.OS;
  const originalConfirm = (window as { confirm?: unknown }).confirm;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  (window as { confirm?: unknown }).confirm = confirmMock;
  try {
    body();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    (window as { confirm?: unknown }).confirm = originalConfirm;
  }
}

describe('PhotoGrid', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marchează vizibil prima poză drept principală', () => {
    const { getAllByTestId, getByLabelText } = renderGrid(tiles('a.jpg', 'b.jpg'));

    expect(getAllByTestId('photo-main-badge')).toHaveLength(1);
    expect(getByLabelText('Poza principală')).toBeTruthy();
  });

  it('arată câte poze sunt și care e minimul', () => {
    // Min/max vin din config (app.json) — le citim de acolo, nu le hardcodăm,
    // ca testul să nu se spargă când limitele se ajustează.
    const { getByText } = renderGrid(tiles('a.jpg'));
    expect(
      getByText(
        `Poze (1/${PHOTO_LIMITS.max}) — minimum ${PHOTO_LIMITS.min}. Prima poză este cea principală.`,
      ),
    ).toBeTruthy();
  });

  it('ștergerea cere confirmare; „Anulează" nu șterge nimic', () => {
    const onRemove = jest.fn();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
    fireEvent.press(getByTestId('photo-remove-0'));

    expect(Alert.alert).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled(); // fără confirmare → fără ștergere
  });

  it('ștergerea se produce doar după confirmarea explicită', () => {
    const onRemove = jest.fn();
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });

    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
    fireEvent.press(getByTestId('photo-remove-1'));

    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('web: „✕" folosește window.confirm; confirmat → șterge la indexul corect', () => {
    // Pe web Alert.alert e no-op, deci confirmarea trece prin window.confirm.
    const confirmMock = jest.fn(() => true);
    withWebPlatform(confirmMock, () => {
      const onRemove = jest.fn();
      const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
      fireEvent.press(getByTestId('photo-remove-1'));

      expect(confirmMock).toHaveBeenCalledWith('Poza va fi eliminată din profil.');
      expect(onRemove).toHaveBeenCalledWith(1);
    });
  });

  it('web: window.confirm respins → NU șterge nimic', () => {
    const confirmMock = jest.fn(() => false);
    withWebPlatform(confirmMock, () => {
      const onRemove = jest.fn();
      const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
      fireEvent.press(getByTestId('photo-remove-0'));

      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  it('web: avertisment special când se șterge poza principală (index 0)', () => {
    const confirmMock = jest.fn(() => true);
    withWebPlatform(confirmMock, () => {
      const onRemove = jest.fn();
      const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
      fireEvent.press(getByTestId('photo-remove-0'));

      expect(confirmMock).toHaveBeenCalledWith(
        'Este poza ta principală. Următoarea poză îi va lua locul.',
      );
      expect(onRemove).toHaveBeenCalledWith(0);
    });
  });

  it('nativ: avertisment special în Alert.alert la ștergerea pozei principale', () => {
    let capturedMessage: string | undefined;
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, message?: string) => {
        capturedMessage = message;
      });

    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'));
    fireEvent.press(getByTestId('photo-remove-0'));

    expect(capturedMessage).toBe(
      'Este poza ta principală. Următoarea poză îi va lua locul.',
    );
  });

  it('reordonarea trimite indecșii corecți (a doua poză devine principală)', () => {
    const onMove = jest.fn();
    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg', 'c.jpg'), { onMove });

    fireEvent.press(getByTestId('photo-move-left-1'));

    expect(onMove).toHaveBeenCalledWith(1, 0);
    // Ordinea rezultată — prima poză (principala) devine `b.jpg`.
    expect(moveItem(['a.jpg', 'b.jpg', 'c.jpg'], 1, 0)).toEqual([
      'b.jpg',
      'a.jpg',
      'c.jpg',
    ]);
  });

  it('nu poți muta prima poză mai la stânga, nici ultima mai la dreapta', () => {
    const onMove = jest.fn();
    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onMove });

    fireEvent.press(getByTestId('photo-move-left-0'));
    fireEvent.press(getByTestId('photo-move-right-1'));

    expect(onMove).not.toHaveBeenCalled();
  });

  it('afișează progresul uploadului pe poza în curs', () => {
    const { getByTestId, getByText } = renderGrid([
      { key: 'a.jpg', uri: 'a.jpg', uploading: true, progress: 0.42 },
    ]);

    expect(getByTestId('photo-progress-0')).toBeTruthy();
    expect(getByText('42%')).toBeTruthy();
  });

  it('la maximul de poze ascunde butonul de adăugare și explică de ce', () => {
    const uris = Array.from({ length: 9 }, (_, i) => `p${i}.jpg`);
    const { queryByTestId, getByText } = renderGrid(tiles(...uris));

    expect(queryByTestId('photo-add')).toBeNull();
    expect(getByText('Ai atins numărul maxim de 9 poze.')).toBeTruthy();
  });

  it('permisiune refuzată → mesaj + buton de recuperare „Deschide setările"', () => {
    const onOpenSettings = jest.fn();
    const { getByText, getByTestId } = renderGrid(
      [],
      { onOpenSettings },
      { permissionDenied: true, error: 'Nu avem acces la galerie.' },
    );

    expect(getByText('Nu avem acces la galerie.')).toBeTruthy();
    fireEvent.press(getByTestId('photo-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('moveItem', () => {
  it('mută elementul și lasă lista originală neatinsă', () => {
    const original = ['a', 'b', 'c'];
    expect(moveItem(original, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  it('ignoră indecșii invalizi', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
